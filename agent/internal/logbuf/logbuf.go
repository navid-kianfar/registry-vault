// Package logbuf keeps the last N lines of a process's output in memory so the
// management API can serve them, while passing every line through to the
// agent's own stdout.
package logbuf

import (
	"bytes"
	"io"
	"sync"
)

// Capacity is how many lines each source keeps.
const Capacity = 2000

// maxLineLen caps a single line so a registry that emits a megabyte without a
// newline cannot grow the ring without bound.
const maxLineLen = 8 * 1024

// Ring is a fixed-size ring of the most recent lines. It is safe for concurrent
// use.
type Ring struct {
	mu    sync.RWMutex
	lines []string
	next  int
	count int
}

// NewRing returns an empty ring holding at most Capacity lines.
func NewRing() *Ring {
	return &Ring{lines: make([]string, Capacity)}
}

// Add appends one line, dropping the oldest when the ring is full.
func (r *Ring) Add(line string) {
	if len(line) > maxLineLen {
		line = line[:maxLineLen]
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	r.lines[r.next] = line
	r.next = (r.next + 1) % Capacity
	if r.count < Capacity {
		r.count++
	}
}

// Last returns up to n most recent lines, oldest first. The result is a copy;
// callers never see the ring's own storage.
func (r *Ring) Last(n int) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if n > r.count {
		n = r.count
	}
	if n <= 0 {
		return []string{}
	}

	out := make([]string, n)
	start := r.next - n
	for i := 0; i < n; i++ {
		index := ((start+i)%Capacity + Capacity) % Capacity
		out[i] = r.lines[index]
	}
	return out
}

// Writer splits the bytes written to it into lines, stores each in a Ring and
// forwards the raw bytes to a pass-through writer. A partial line is held until
// its newline arrives.
type Writer struct {
	ring    *Ring
	through io.Writer

	mu      sync.Mutex
	partial []byte
}

// NewWriter returns a Writer feeding ring and echoing to through. through may
// be nil.
func NewWriter(ring *Ring, through io.Writer) *Writer {
	return &Writer{ring: ring, through: through}
}

// Write implements io.Writer. It never reports an error from the pass-through
// writer as a failure of the child's output capture.
func (w *Writer) Write(p []byte) (int, error) {
	if w.through != nil {
		_, _ = w.through.Write(p)
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	w.partial = append(w.partial, p...)
	for {
		index := bytes.IndexByte(w.partial, '\n')
		if index < 0 {
			break
		}
		line := string(w.partial[:index])
		trimmed := trimCR(line)
		w.ring.Add(trimmed)
		w.partial = w.partial[index+1:]
	}

	// A line that never ends is flushed once it passes the cap, so the buffer
	// cannot grow without bound.
	if len(w.partial) > maxLineLen {
		w.ring.Add(string(w.partial[:maxLineLen]))
		w.partial = w.partial[:0]
	}
	return len(p), nil
}

// Flush stores any buffered partial line. Call it when the source closes.
func (w *Writer) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if len(w.partial) == 0 {
		return
	}
	w.ring.Add(string(w.partial))
	w.partial = w.partial[:0]
}

func trimCR(line string) string {
	last := len(line) - 1
	if last >= 0 && line[last] == '\r' {
		return line[:last]
	}
	return line
}
