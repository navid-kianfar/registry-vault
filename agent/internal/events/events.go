// Package events is the agent's append-only pull/push log. Registry Vault
// polls it by sequence number; nothing is ever pushed to Vault, so the agent
// never needs to reach it.
package events

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/atomicio"
)

// Type is what happened to a manifest.
type Type string

const (
	// TypePull is a successful GET of a manifest.
	TypePull Type = "pull"
	// TypePush is a successful PUT of a manifest.
	TypePush Type = "push"
	// TypeDelete is a successful DELETE of a manifest.
	TypeDelete Type = "delete"
)

const (
	// logFile is the event log inside the data directory.
	logFile = "events.log"
	// MaxLimit is the largest page the API serves.
	MaxLimit = 1000
	// DefaultLimit is the page size when the caller does not ask for one.
	DefaultLimit = 500
	// maxInMemory bounds the log the agent keeps in memory and on disk, so a
	// busy registry cannot fill either. Retention usually bites first.
	maxInMemory = 50000
	// rewriteSlack is how far past maxInMemory the log grows before it is
	// rewritten, so a rewrite is amortised over many appends.
	rewriteSlack = 5000
)

// ErrClosed is returned by Append after the log has been closed.
var ErrClosed = errors.New("the event log is closed")

// Event is one recorded manifest operation.
type Event struct {
	Seq        uint64    `json:"seq"`
	Type       Type      `json:"type"`
	Repository string    `json:"repository"`
	Reference  string    `json:"reference"`
	Digest     string    `json:"digest"`
	Actor      string    `json:"actor"`
	RemoteAddr string    `json:"remoteAddr"`
	UserAgent  string    `json:"userAgent"`
	At         time.Time `json:"at"`
}

// Page is one response of GET /api/v1/events.
type Page struct {
	Events    []Event `json:"events"`
	NextAfter uint64  `json:"nextAfter"`
	OldestSeq uint64  `json:"oldestSeq"`
	Gap       bool    `json:"gap,omitempty"`
}

// Log is the event log. It is safe for concurrent use.
type Log struct {
	path      string
	retention time.Duration

	mu      sync.Mutex
	entries []Event
	lastSeq uint64
	file    *os.File

	now func() time.Time
}

// Open loads the log from dataDir and opens it for appending. retentionDays
// below 1 disables time-based pruning.
func Open(dataDir string, retentionDays int) (*Log, error) {
	path := filepath.Join(dataDir, logFile)
	mkdirErr := os.MkdirAll(dataDir, 0o750)
	if mkdirErr != nil {
		return nil, fmt.Errorf("create data dir: %w", mkdirErr)
	}

	l := &Log{
		path:      path,
		retention: time.Duration(retentionDays) * 24 * time.Hour,
		now:       func() time.Time { return time.Now().UTC() },
	}

	loaded, loadErr := readAll(path)
	if loadErr != nil {
		return nil, loadErr
	}
	l.entries = loaded
	if len(loaded) > 0 {
		l.lastSeq = loaded[len(loaded)-1].Seq
	}

	handle, openErr := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if openErr != nil {
		return nil, fmt.Errorf("open event log: %w", openErr)
	}
	l.file = handle
	return l, nil
}

// Append records one event, assigning it the next sequence number.
//
// What is in memory is exactly what is on disk: an event the log could not
// write is not kept, and its sequence number is spent rather than reused. That
// leaves a hole the log can see, so Query reports a gap instead of quietly
// handing Vault a number that would vanish on the next restart. The caller
// gets the error and logs it.
func (l *Log) Append(event Event) (Event, error) {
	l.mu.Lock()

	l.lastSeq++
	event.Seq = l.lastSeq
	if event.At.IsZero() {
		event.At = l.now()
	}
	event.At = event.At.UTC()

	line, marshalErr := json.Marshal(event)
	if marshalErr != nil {
		l.mu.Unlock()
		return event, fmt.Errorf("encode event %d: %w", event.Seq, marshalErr)
	}
	if l.file == nil {
		l.mu.Unlock()
		return event, fmt.Errorf("append event %d: %w", event.Seq, ErrClosed)
	}

	// The write happens under the lock so that the order on disk is the order
	// of the sequence numbers, and so no reader sees an entry that is not
	// durable yet.
	withNewline := append(line, '\n')
	_, writeErr := l.file.Write(withNewline)
	if writeErr != nil {
		l.mu.Unlock()
		return event, fmt.Errorf("append event %d: %w", event.Seq, writeErr)
	}

	l.entries = append(l.entries, event)
	overflowing := len(l.entries) > maxInMemory+rewriteSlack
	l.mu.Unlock()

	if overflowing {
		trimErr := l.Prune()
		if trimErr != nil {
			return event, trimErr
		}
	}
	return event, nil
}

// Query returns the events after seq, oldest first. limit is clamped to
// MaxLimit and defaults to DefaultLimit.
func (l *Log) Query(after uint64, limit int) Page {
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	oldest := uint64(0)
	if len(l.entries) > 0 {
		oldest = l.entries[0].Seq
	}

	// Sequence numbers are ordered but not necessarily contiguous: a line the
	// log could not write, or one a crash left unparsable, leaves a hole. So
	// the first entry after `after` is found by its sequence number, never by
	// arithmetic on the index.
	start := l.indexAfterLocked(after)

	end := start + limit
	if end > len(l.entries) {
		end = len(l.entries)
	}

	selected := l.entries[start:end]
	page := Page{
		Events:    slices.Clone(selected),
		OldestSeq: oldest,
	}
	if len(page.Events) > 0 {
		page.NextAfter = page.Events[len(page.Events)-1].Seq
	} else if after > l.lastSeq {
		page.NextAfter = after
	} else {
		page.NextAfter = l.lastSeq
	}
	page.Gap = l.hasGapLocked(after, page.Events)
	return page
}

// indexAfterLocked is the index of the first entry whose sequence number is
// greater than after, or len(entries) when there is none.
func (l *Log) indexAfterLocked(after uint64) int {
	index, _ := slices.BinarySearchFunc(l.entries, after, func(candidate Event, target uint64) int {
		if candidate.Seq <= target {
			return -1
		}
		return 1
	})
	return index
}

// hasGapLocked reports whether anything between what the caller last saw and
// what this page returns is missing — pruned, never written, or lost to a
// truncated line. Vault uses it to know its counts since `after` are
// incomplete, so it errs towards saying yes.
func (l *Log) hasGapLocked(after uint64, page []Event) bool {
	if len(page) == 0 {
		// Nothing follows `after`. That is only a hole if the log has since
		// moved past it, which means those events are gone.
		return after < l.lastSeq
	}
	if page[0].Seq > after+1 {
		return true
	}
	for index := 1; index < len(page); index++ {
		if page[index].Seq != page[index-1].Seq+1 {
			return true
		}
	}
	return false
}

// Prune drops events past the retention window and past the in-memory cap, then
// rewrites the log file atomically. It is safe to call on a timer.
func (l *Log) Prune() error {
	l.mu.Lock()

	kept := l.entries
	if l.retention > 0 {
		cutoff := l.now().Add(-l.retention)
		firstKept := 0
		for index, event := range kept {
			if event.At.After(cutoff) {
				break
			}
			firstKept = index + 1
		}
		kept = kept[firstKept:]
	}
	if len(kept) > maxInMemory {
		kept = kept[len(kept)-maxInMemory:]
	}
	if len(kept) == len(l.entries) {
		l.mu.Unlock()
		return nil
	}
	l.entries = slices.Clone(kept)
	snapshot := slices.Clone(l.entries)
	l.mu.Unlock()

	return l.rewrite(snapshot)
}

// Close flushes and closes the underlying file.
func (l *Log) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.file == nil {
		return nil
	}
	syncErr := l.file.Sync()
	closeErr := l.file.Close()
	l.file = nil
	if syncErr != nil {
		return fmt.Errorf("sync event log: %w", syncErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close event log: %w", closeErr)
	}
	return nil
}

// rewrite replaces the log file with the given events and reopens the append
// handle on the new file.
func (l *Log) rewrite(snapshot []Event) error {
	buffer := make([]byte, 0, len(snapshot)*160)
	for _, event := range snapshot {
		line, marshalErr := json.Marshal(event)
		if marshalErr != nil {
			return fmt.Errorf("encode event %d: %w", event.Seq, marshalErr)
		}
		buffer = append(buffer, line...)
		buffer = append(buffer, '\n')
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
	writeErr := atomicio.WriteFile(l.path, buffer)
	if writeErr != nil {
		return fmt.Errorf("rewrite event log: %w", writeErr)
	}
	handle, openErr := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if openErr != nil {
		return fmt.Errorf("reopen event log: %w", openErr)
	}
	l.file = handle
	return nil
}

// readAll parses the log file. A corrupt line is skipped rather than fatal: a
// truncated last line after a crash must not stop the agent.
func readAll(path string) ([]Event, error) {
	file, openErr := os.Open(path)
	if os.IsNotExist(openErr) {
		return make([]Event, 0), nil
	}
	if openErr != nil {
		return nil, fmt.Errorf("open event log: %w", openErr)
	}
	defer file.Close()

	out := make([]Event, 0, 256)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var event Event
		unmarshalErr := json.Unmarshal(line, &event)
		if unmarshalErr != nil {
			continue
		}
		out = append(out, event)
	}
	scanErr := scanner.Err()
	if scanErr != nil {
		return nil, fmt.Errorf("read event log: %w", scanErr)
	}
	slices.SortFunc(out, func(a, b Event) int {
		switch {
		case a.Seq < b.Seq:
			return -1
		case a.Seq > b.Seq:
			return 1
		default:
			return 0
		}
	})

	// A crash between a rewrite and its rename can leave a sequence number
	// twice. Vault must never see one twice, so the first wins.
	deduped := out[:0]
	previous := uint64(0)
	for _, event := range out {
		if event.Seq == previous && previous != 0 {
			continue
		}
		previous = event.Seq
		deduped = append(deduped, event)
	}
	return deduped, nil
}
