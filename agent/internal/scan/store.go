package scan

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/atomicio"
)

// update stores a new version of a scan, in memory and on disk.
func (s *Scanner) update(record Scan) {
	s.mu.Lock()
	s.scans[record.ID] = record.clone()
	s.mu.Unlock()

	persistErr := s.persist(record)
	if persistErr != nil {
		s.logger.Error("could not persist scan", "scan", record.ID, "error", persistErr)
	}
}

// fail marks a scan failed with a message the caller may read. Trivy's own
// error text is the useful part and is safe to show: it names the image and
// what went wrong, not the agent's internals.
func (s *Scanner) fail(id, message string) {
	s.mu.Lock()
	record, ok := s.scans[id]
	s.mu.Unlock()

	if !ok {
		return
	}
	finishedAt := time.Now().UTC()
	record.State = StateFailed
	record.FinishedAt = &finishedAt
	record.Error = &message
	s.update(record)
	s.logger.Warn("scan failed", "scan", id, "repository", record.Repository, "error", message)
}

func (s *Scanner) persist(record Scan) error {
	path := filepath.Join(s.resultsDir, record.ID+".json")
	writeErr := atomicio.WriteJSON(path, record)
	if writeErr != nil {
		return writeErr
	}
	s.prune()
	return nil
}

// prune keeps the newest resultLimit scans and removes the rest from memory
// and disk.
func (s *Scanner) prune() {
	s.mu.Lock()
	if len(s.ordered) <= resultLimit {
		s.mu.Unlock()
		return
	}
	dropped := slices.Clone(s.ordered[resultLimit:])
	s.ordered = slices.Clone(s.ordered[:resultLimit])
	for _, id := range dropped {
		delete(s.scans, id)
	}
	s.mu.Unlock()

	for _, id := range dropped {
		path := filepath.Join(s.resultsDir, id+".json")
		removeErr := os.Remove(path)
		if removeErr != nil && !os.IsNotExist(removeErr) {
			s.logger.Warn("could not remove old scan result", "scan", id, "error", removeErr)
		}
	}
}

// load reads stored results at startup. A scan that was running when the agent
// stopped is marked failed: its Trivy process is gone.
func (s *Scanner) load() error {
	entries, readErr := os.ReadDir(s.resultsDir)
	if os.IsNotExist(readErr) {
		return nil
	}
	if readErr != nil {
		return fmt.Errorf("read scan results: %w", readErr)
	}

	loaded := make([]Scan, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(s.resultsDir, entry.Name())
		var record Scan
		found, parseErr := atomicio.ReadJSON(path, &record)
		if parseErr != nil || !found {
			s.logger.Warn("skipping unreadable scan result", "path", path, "error", parseErr)
			continue
		}
		if record.State == StateRunning || record.State == StateQueued {
			record = markInterrupted(record)
		}
		loaded = append(loaded, record)
	}

	slices.SortFunc(loaded, func(a, b Scan) int {
		if a.QueuedAt.Equal(b.QueuedAt) {
			return strings.Compare(b.ID, a.ID)
		}
		if a.QueuedAt.After(b.QueuedAt) {
			return -1
		}
		return 1
	})

	ordered := make([]string, len(loaded))
	for index, record := range loaded {
		ordered[index] = record.ID
		s.scans[record.ID] = record
	}
	s.ordered = ordered
	s.prune()
	return nil
}

func markInterrupted(record Scan) Scan {
	message := "interrupted: the agent stopped while this scan was queued or running"
	record.State = StateFailed
	record.Error = &message
	if record.FinishedAt == nil {
		now := time.Now().UTC()
		record.FinishedAt = &now
	}
	return record
}

// newID is sortable by time and unique within a second.
func newID(at time.Time) string {
	suffix := make([]byte, 4)
	_, readErr := rand.Read(suffix)
	if readErr != nil {
		// A collision-free id matters less than continuing; the timestamp and
		// the map guarantee practical uniqueness on this path.
		return "scan_" + at.Format("20060102T150405Z")
	}
	encoded := hex.EncodeToString(suffix)
	return "scan_" + at.Format("20060102T150405Z") + "_" + encoded
}
