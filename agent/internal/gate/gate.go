// Package gate implements the write gate: the single place that decides
// whether a mutating request to the registry may proceed. Garbage collection
// and repository removal take a temporary hold; maintenance mode is a
// persisted, operator-controlled hold.
package gate

import (
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/atomicio"
)

// maintenanceFile is the state file inside the data directory.
const maintenanceFile = "maintenance.json"

// defaultReason is used when maintenance is switched on without one.
const defaultReason = "maintenance"

// Maintenance is the operator-controlled read-only state, as the management
// API reports it.
type Maintenance struct {
	ReadOnly bool       `json:"readOnly"`
	Reason   *string    `json:"reason"`
	Since    *time.Time `json:"since"`
}

// Gate guards writes. The zero value is not usable; call New.
type Gate struct {
	path string

	mu          sync.Mutex
	cond        *sync.Cond
	maintenance Maintenance
	holds       map[uint64]string
	nextHold    uint64
	inFlight    int
}

// New loads the persisted maintenance state from dataDir. A missing state file
// means the gate starts open.
func New(dataDir string) (*Gate, error) {
	path := filepath.Join(dataDir, maintenanceFile)
	g := &Gate{
		path:  path,
		holds: make(map[uint64]string),
	}
	g.cond = sync.NewCond(&g.mu)

	var stored Maintenance
	_, readErr := atomicio.ReadJSON(path, &stored)
	if readErr != nil {
		return nil, fmt.Errorf("load maintenance state: %w", readErr)
	}
	g.maintenance = normalise(stored)
	return g, nil
}

// Maintenance returns the current persisted read-only state.
func (g *Gate) Maintenance() Maintenance {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.maintenance
}

// SetMaintenance switches read-only mode on or off and persists the new state.
// Switching it on again with a different reason refreshes the reason but keeps
// the original start time.
func (g *Gate) SetMaintenance(readOnly bool, reason string) (Maintenance, error) {
	g.mu.Lock()

	if !readOnly {
		g.maintenance = Maintenance{ReadOnly: false}
	} else {
		text := reason
		if text == "" {
			text = defaultReason
		}
		since := g.maintenance.Since
		if !g.maintenance.ReadOnly || since == nil {
			now := time.Now().UTC()
			since = &now
		}
		g.maintenance = Maintenance{ReadOnly: true, Reason: &text, Since: since}
	}
	state := g.maintenance
	g.mu.Unlock()

	writeErr := atomicio.WriteJSON(g.path, state)
	if writeErr != nil {
		return state, fmt.Errorf("persist maintenance state: %w", writeErr)
	}
	return state, nil
}

// Hold closes the gate for reason and waits up to drainTimeout for in-flight
// writes to finish. It always returns a release function — call it with defer,
// so the gate reopens even when the work panics. drained reports whether every
// in-flight write finished before the timeout.
func (g *Gate) Hold(reason string, drainTimeout time.Duration) (release func(), drained bool) {
	g.mu.Lock()

	id := g.nextHold
	g.nextHold++
	g.holds[id] = reason

	deadline := time.Now().Add(drainTimeout)
	timer := time.AfterFunc(drainTimeout, g.broadcast)
	for g.inFlight > 0 && time.Now().Before(deadline) {
		g.cond.Wait()
	}
	drained = g.inFlight == 0
	g.mu.Unlock()
	timer.Stop()

	release = sync.OnceFunc(func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		delete(g.holds, id)
	})
	return release, drained
}

// Closed reports whether writes are currently rejected and why.
func (g *Gate) Closed() (bool, string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.closedLocked()
}

// BeginWrite admits one mutating request. When ok is true the caller must call
// done exactly once — done is safe to call more than once and is meant for
// defer. When ok is false, reason says what is blocking.
func (g *Gate) BeginWrite() (done func(), ok bool, reason string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	closed, why := g.closedLocked()
	if closed {
		return nil, false, why
	}
	g.inFlight++
	return sync.OnceFunc(g.finishWrite), true, ""
}

// InFlight reports how many writes are currently running. It exists for tests
// and diagnostics.
func (g *Gate) InFlight() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.inFlight
}

func (g *Gate) finishWrite() {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.inFlight > 0 {
		g.inFlight--
	}
	g.cond.Broadcast()
}

func (g *Gate) broadcast() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.cond.Broadcast()
}

// closedLocked answers with the lowest-numbered hold's reason, so the message
// stays stable while several holds overlap, and falls back to maintenance.
func (g *Gate) closedLocked() (bool, string) {
	if len(g.holds) > 0 {
		var lowest uint64
		reason := ""
		first := true
		for id, why := range g.holds {
			if first || id < lowest {
				lowest = id
				reason = why
				first = false
			}
		}
		return true, reason
	}
	if g.maintenance.ReadOnly {
		if g.maintenance.Reason != nil {
			return true, *g.maintenance.Reason
		}
		return true, defaultReason
	}
	return false, ""
}

// normalise repairs a state file that says read-only without a reason or a
// start time, so the API never reports an impossible combination.
func normalise(state Maintenance) Maintenance {
	if !state.ReadOnly {
		return Maintenance{ReadOnly: false}
	}
	if state.Reason == nil {
		text := defaultReason
		state.Reason = &text
	}
	if state.Since == nil {
		now := time.Now().UTC()
		state.Since = &now
	}
	return state
}
