package gate

import (
	"testing"
	"time"
)

func newTestGate(t *testing.T) *Gate {
	t.Helper()

	g, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return g
}

func TestWritesPassWhenTheGateIsOpen(t *testing.T) {
	g := newTestGate(t)

	done, ok, reason := g.BeginWrite()
	if !ok {
		t.Fatalf("expected the write to be admitted, got reason %q", reason)
	}
	if g.InFlight() != 1 {
		t.Fatalf("expected 1 in-flight write, got %d", g.InFlight())
	}
	done()
	if g.InFlight() != 0 {
		t.Fatalf("expected the write to be released, got %d in flight", g.InFlight())
	}
}

func TestHoldRejectsWritesAndReopensOnRelease(t *testing.T) {
	g := newTestGate(t)

	release, drained := g.Hold("garbage collection", time.Second)
	if !drained {
		t.Fatal("expected an idle gate to drain immediately")
	}

	_, ok, reason := g.BeginWrite()
	if ok {
		t.Fatal("expected the write to be rejected while a hold is active")
	}
	if reason != "garbage collection" {
		t.Fatalf("reason = %q, want %q", reason, "garbage collection")
	}

	release()
	_, ok, _ = g.BeginWrite()
	if !ok {
		t.Fatal("expected the gate to reopen after the hold was released")
	}
}

// The gate must reopen even when the work under it panics: a deferred release
// is the only thing standing between a failed collection and a registry that
// rejects every push until it is restarted.
func TestGateReopensWhenTheWorkPanics(t *testing.T) {
	g := newTestGate(t)

	func() {
		defer func() {
			recovered := recover()
			if recovered == nil {
				t.Error("expected the panic to reach the test")
			}
		}()
		release, _ := g.Hold("garbage collection", time.Second)
		defer release()
		panic("collector blew up")
	}()

	_, ok, reason := g.BeginWrite()
	if !ok {
		t.Fatalf("expected the gate to be open after a panic, got reason %q", reason)
	}
}

func TestHoldWaitsForInFlightWrites(t *testing.T) {
	g := newTestGate(t)

	done, ok, _ := g.BeginWrite()
	if !ok {
		t.Fatal("expected the write to be admitted")
	}

	finished := make(chan struct{})
	go func() {
		time.Sleep(50 * time.Millisecond)
		done()
		close(finished)
	}()

	release, drained := g.Hold("garbage collection", 2*time.Second)
	defer release()
	<-finished

	if !drained {
		t.Fatal("expected the hold to wait until the in-flight write finished")
	}
}

func TestHoldGivesUpAfterTheDrainTimeout(t *testing.T) {
	g := newTestGate(t)

	done, ok, _ := g.BeginWrite()
	if !ok {
		t.Fatal("expected the write to be admitted")
	}
	defer done()

	release, drained := g.Hold("garbage collection", 50*time.Millisecond)
	defer release()

	if drained {
		t.Fatal("expected the hold to report that it did not drain")
	}
}

func TestMaintenanceClosesTheGateAndPersists(t *testing.T) {
	dir := t.TempDir()
	g, err := New(dir)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	state, setErr := g.SetMaintenance(true, "backup")
	if setErr != nil {
		t.Fatalf("SetMaintenance: %v", setErr)
	}
	if !state.ReadOnly || state.Reason == nil || *state.Reason != "backup" || state.Since == nil {
		t.Fatalf("unexpected state: %+v", state)
	}

	_, ok, reason := g.BeginWrite()
	if ok {
		t.Fatal("expected writes to be rejected in maintenance")
	}
	if reason != "backup" {
		t.Fatalf("reason = %q, want %q", reason, "backup")
	}

	reloaded, reloadErr := New(dir)
	if reloadErr != nil {
		t.Fatalf("New after restart: %v", reloadErr)
	}
	closed, reloadedReason := reloaded.Closed()
	if !closed || reloadedReason != "backup" {
		t.Fatalf("maintenance did not survive a restart: closed=%v reason=%q", closed, reloadedReason)
	}

	_, clearErr := reloaded.SetMaintenance(false, "")
	if clearErr != nil {
		t.Fatalf("SetMaintenance(false): %v", clearErr)
	}
	stillClosed, _ := reloaded.Closed()
	if stillClosed {
		t.Fatal("expected the gate to open when maintenance is switched off")
	}
}

// A hold outranks maintenance mode, and clearing the hold must not reopen a
// gate that maintenance is still holding closed.
func TestHoldAndMaintenanceAreIndependent(t *testing.T) {
	g := newTestGate(t)

	_, setErr := g.SetMaintenance(true, "backup")
	if setErr != nil {
		t.Fatalf("SetMaintenance: %v", setErr)
	}
	release, _ := g.Hold("garbage collection", time.Second)

	_, _, reason := g.BeginWrite()
	if reason != "garbage collection" {
		t.Fatalf("reason = %q, want the hold's reason", reason)
	}

	release()
	closed, afterReason := g.Closed()
	if !closed || afterReason != "backup" {
		t.Fatalf("maintenance should still hold the gate: closed=%v reason=%q", closed, afterReason)
	}
}
