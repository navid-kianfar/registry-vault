package events

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func newTestLog(t *testing.T) *Log {
	t.Helper()

	log, err := Open(t.TempDir(), 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		closeErr := log.Close()
		if closeErr != nil {
			t.Errorf("Close: %v", closeErr)
		}
	})
	return log
}

func appendN(t *testing.T, log *Log, count int) {
	t.Helper()

	for index := 0; index < count; index++ {
		_, err := log.Append(Event{Type: TypePull, Repository: "app", Reference: "1.0.0", Actor: "ci"})
		if err != nil {
			t.Fatalf("Append: %v", err)
		}
	}
}

func TestAppendAssignsMonotonicSequences(t *testing.T) {
	log := newTestLog(t)

	first, err := log.Append(Event{Type: TypePush, Repository: "app"})
	if err != nil {
		t.Fatalf("Append: %v", err)
	}
	second, secondErr := log.Append(Event{Type: TypePull, Repository: "app"})
	if secondErr != nil {
		t.Fatalf("Append: %v", secondErr)
	}
	if first.Seq != 1 || second.Seq != 2 {
		t.Fatalf("sequences = %d, %d; want 1, 2", first.Seq, second.Seq)
	}
	if first.At.IsZero() {
		t.Fatal("expected Append to stamp the event")
	}
}

func TestQueryPagination(t *testing.T) {
	log := newTestLog(t)
	appendN(t, log, 10)

	cases := []struct {
		name      string
		after     uint64
		limit     int
		wantFirst uint64
		wantCount int
		wantNext  uint64
	}{
		{"from the start", 0, 3, 1, 3, 3},
		{"continuing", 3, 3, 4, 3, 6},
		{"past the end", 10, 5, 0, 0, 10},
		{"beyond the head", 99, 5, 0, 0, 99},
		{"limit larger than the log", 0, 500, 1, 10, 10},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			page := log.Query(testCase.after, testCase.limit)
			if len(page.Events) != testCase.wantCount {
				t.Fatalf("returned %d events, want %d", len(page.Events), testCase.wantCount)
			}
			if testCase.wantCount > 0 && page.Events[0].Seq != testCase.wantFirst {
				t.Fatalf("first seq = %d, want %d", page.Events[0].Seq, testCase.wantFirst)
			}
			if page.NextAfter != testCase.wantNext {
				t.Fatalf("nextAfter = %d, want %d", page.NextAfter, testCase.wantNext)
			}
			if page.Gap {
				t.Fatal("did not expect a gap")
			}
			if page.OldestSeq != 1 {
				t.Fatalf("oldestSeq = %d, want 1", page.OldestSeq)
			}
		})
	}
}

func TestQueryReportsAGapAfterPruning(t *testing.T) {
	dir := t.TempDir()
	log, err := Open(dir, 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer log.Close()

	// Three old events and two fresh ones; retention drops the old ones.
	old := time.Now().UTC().Add(-90 * 24 * time.Hour)
	for index := 0; index < 3; index++ {
		_, appendErr := log.Append(Event{Type: TypePull, Repository: "app", At: old})
		if appendErr != nil {
			t.Fatalf("Append: %v", appendErr)
		}
	}
	appendN(t, log, 2)

	pruneErr := log.Prune()
	if pruneErr != nil {
		t.Fatalf("Prune: %v", pruneErr)
	}

	page := log.Query(0, 100)
	if len(page.Events) != 2 {
		t.Fatalf("returned %d events, want 2", len(page.Events))
	}
	if page.OldestSeq != 4 {
		t.Fatalf("oldestSeq = %d, want 4", page.OldestSeq)
	}
	if !page.Gap {
		t.Fatal("expected gap to be reported when the caller asks from before the oldest event")
	}

	// A caller that is already past the pruned range sees no gap.
	current := log.Query(4, 100)
	if current.Gap {
		t.Fatal("did not expect a gap for a caller inside the retained range")
	}
	if len(current.Events) != 1 || current.Events[0].Seq != 5 {
		t.Fatalf("unexpected page: %+v", current.Events)
	}
}

func TestLogSurvivesAReopen(t *testing.T) {
	dir := t.TempDir()
	log, err := Open(dir, 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	appendN(t, log, 3)
	closeErr := log.Close()
	if closeErr != nil {
		t.Fatalf("Close: %v", closeErr)
	}

	reopened, reopenErr := Open(dir, 30)
	if reopenErr != nil {
		t.Fatalf("Open again: %v", reopenErr)
	}
	defer reopened.Close()

	page := reopened.Query(0, 100)
	if len(page.Events) != 3 {
		t.Fatalf("returned %d events after reopen, want 3", len(page.Events))
	}

	next, appendErr := reopened.Append(Event{Type: TypePush, Repository: "app"})
	if appendErr != nil {
		t.Fatalf("Append: %v", appendErr)
	}
	if next.Seq != 4 {
		t.Fatalf("seq after reopen = %d, want 4", next.Seq)
	}
}

// A log whose sequence numbers have holes — a line a crash truncated, or one
// the log could not write — must still hand every surviving event out exactly
// once. Paging by index arithmetic used to skip past the last of them.
func TestQueryOnANonContiguousLog(t *testing.T) {
	dir := t.TempDir()
	writeRawLog(t, dir, []string{
		`{"seq":1,"type":"pull","repository":"app","at":"2026-09-28T10:00:00Z"}`,
		`{"seq":2,"type":"pull","repository":"app","at":"2026-09-28T10:00:01Z"}`,
		`{"seq":3,"type":"pull","repository":"app",`, // truncated by a crash
		`{"seq":4,"type":"push","repository":"app","at":"2026-09-28T10:00:03Z"}`,
		`{"seq":5,"type":"push","repository":"app","at":"2026-09-28T10:00:04Z"}`,
	})

	log, err := Open(dir, 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer log.Close()

	cases := []struct {
		name     string
		after    uint64
		wantSeqs []uint64
		wantNext uint64
		wantGap  bool
	}{
		{"the last event is still reachable", 4, []uint64{5}, 5, false},
		{"crossing the hole is a gap", 2, []uint64{4, 5}, 5, true},
		{"a page containing the hole is a gap", 0, []uint64{1, 2, 4, 5}, 5, true},
		{"before the hole is clean", 1, []uint64{2, 4, 5}, 5, true},
		{"caught up", 5, nil, 5, false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			page := log.Query(testCase.after, 100)
			got := seqsOf(page.Events)
			if !slices.Equal(got, testCase.wantSeqs) {
				t.Fatalf("seqs = %v, want %v", got, testCase.wantSeqs)
			}
			if page.NextAfter != testCase.wantNext {
				t.Fatalf("nextAfter = %d, want %d", page.NextAfter, testCase.wantNext)
			}
			if page.Gap != testCase.wantGap {
				t.Fatalf("gap = %v, want %v", page.Gap, testCase.wantGap)
			}
		})
	}
}

// Paging across a hole in several steps must still deliver every event: this
// is the loop Registry Vault actually runs.
func TestPollingLoopDeliversEveryEventOnce(t *testing.T) {
	dir := t.TempDir()
	writeRawLog(t, dir, []string{
		`{"seq":1,"type":"pull","repository":"app","at":"2026-09-28T10:00:00Z"}`,
		`{"seq":2,"type":"pull","repository":"app","at":"2026-09-28T10:00:01Z"}`,
		`not json at all`,
		`{"seq":4,"type":"push","repository":"app","at":"2026-09-28T10:00:03Z"}`,
		`{"seq":5,"type":"push","repository":"app","at":"2026-09-28T10:00:04Z"}`,
		`{"seq":9,"type":"delete","repository":"app","at":"2026-09-28T10:00:08Z"}`,
	})

	log, err := Open(dir, 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer log.Close()

	seen := make([]uint64, 0, 8)
	after := uint64(0)
	for step := 0; step < 10; step++ {
		page := log.Query(after, 2)
		if len(page.Events) == 0 {
			break
		}
		seen = append(seen, seqsOf(page.Events)...)
		after = page.NextAfter
	}

	want := []uint64{1, 2, 4, 5, 9}
	if !slices.Equal(seen, want) {
		t.Fatalf("polled %v, want %v", seen, want)
	}
}

// An event the log could not write must not live on in memory: it would be
// handed to Vault once and be gone after a restart. The sequence number is
// spent rather than reused, so the hole stays visible as a gap.
func TestAppendDoesNotKeepAnEventItCouldNotWrite(t *testing.T) {
	dir := t.TempDir()
	log, err := Open(dir, 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer log.Close()

	first, firstErr := log.Append(Event{Type: TypePush, Repository: "app"})
	if firstErr != nil {
		t.Fatalf("Append: %v", firstErr)
	}

	// A read-only handle fails every write, the way a full or broken disk does.
	broken, openErr := os.OpenFile(filepath.Join(dir, logFile), os.O_RDONLY, 0)
	if openErr != nil {
		t.Fatalf("open read-only: %v", openErr)
	}
	log.mu.Lock()
	healthy := log.file
	log.file = broken
	log.mu.Unlock()

	lost, appendErr := log.Append(Event{Type: TypePush, Repository: "app"})
	if appendErr == nil {
		t.Fatal("expected the failed write to be reported")
	}
	if lost.Seq != first.Seq+1 {
		t.Fatalf("lost seq = %d, want %d", lost.Seq, first.Seq+1)
	}

	log.mu.Lock()
	log.file = healthy
	log.mu.Unlock()
	_ = broken.Close()

	next, nextErr := log.Append(Event{Type: TypePull, Repository: "app"})
	if nextErr != nil {
		t.Fatalf("Append: %v", nextErr)
	}
	if next.Seq != lost.Seq+1 {
		t.Fatalf("next seq = %d, want %d — a spent number must never be reused", next.Seq, lost.Seq+1)
	}

	page := log.Query(0, 100)
	got := seqsOf(page.Events)
	want := []uint64{first.Seq, next.Seq}
	if !slices.Equal(got, want) {
		t.Fatalf("seqs = %v, want %v — the unwritten event must not be served", got, want)
	}
	if !page.Gap {
		t.Fatal("expected a gap where the event could not be written")
	}

	// The same holds after a restart: nothing in memory outlived the disk.
	closeErr := log.Close()
	if closeErr != nil {
		t.Fatalf("Close: %v", closeErr)
	}
	reopened, reopenErr := Open(dir, 30)
	if reopenErr != nil {
		t.Fatalf("Open: %v", reopenErr)
	}
	defer reopened.Close()

	reloaded := reopened.Query(0, 100)
	if !slices.Equal(seqsOf(reloaded.Events), want) {
		t.Fatalf("seqs after restart = %v, want %v", seqsOf(reloaded.Events), want)
	}
}

func TestAppendAfterCloseIsRefused(t *testing.T) {
	dir := t.TempDir()
	log, err := Open(dir, 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	closeErr := log.Close()
	if closeErr != nil {
		t.Fatalf("Close: %v", closeErr)
	}

	_, appendErr := log.Append(Event{Type: TypePull, Repository: "app"})
	if !errors.Is(appendErr, ErrClosed) {
		t.Fatalf("error = %v, want ErrClosed", appendErr)
	}
}

func TestDuplicateSequenceNumbersAreDropped(t *testing.T) {
	dir := t.TempDir()
	writeRawLog(t, dir, []string{
		`{"seq":1,"type":"pull","repository":"app","at":"2026-09-28T10:00:00Z"}`,
		`{"seq":1,"type":"pull","repository":"app","at":"2026-09-28T10:00:00Z"}`,
		`{"seq":2,"type":"push","repository":"app","at":"2026-09-28T10:00:01Z"}`,
	})

	log, err := Open(dir, 30)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer log.Close()

	page := log.Query(0, 100)
	if !slices.Equal(seqsOf(page.Events), []uint64{1, 2}) {
		t.Fatalf("seqs = %v, want [1 2]", seqsOf(page.Events))
	}
	if page.Gap {
		t.Fatal("did not expect a gap for a duplicated line")
	}
}

func writeRawLog(t *testing.T, dir string, lines []string) {
	t.Helper()

	content := strings.Join(lines, "\n") + "\n"
	writeErr := os.WriteFile(filepath.Join(dir, logFile), []byte(content), 0o600)
	if writeErr != nil {
		t.Fatalf("write event log: %v", writeErr)
	}
}

func seqsOf(events []Event) []uint64 {
	if len(events) == 0 {
		return nil
	}
	out := make([]uint64, len(events))
	for index, event := range events {
		out[index] = event.Seq
	}
	return out
}

func TestQueryClampsTheLimit(t *testing.T) {
	log := newTestLog(t)
	appendN(t, log, 5)

	page := log.Query(0, 0)
	if len(page.Events) != 5 {
		t.Fatalf("returned %d events, want 5 with the default limit", len(page.Events))
	}
}
