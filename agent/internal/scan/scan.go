// Package scan runs Trivy against images in the child registry, one at a time
// from a bounded queue, and keeps the results on disk.
package scan

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	// queueCapacity is how many scans may wait. Trivy is heavy; a deeper
	// queue only hides that the agent cannot keep up.
	queueCapacity = 50
	// resultLimit is how many results are kept on disk.
	resultLimit = 500
	// listLimit is how many scans the list endpoint returns.
	listLimit = 10
	// scanTimeout bounds one Trivy run, database download included.
	scanTimeout = 15 * time.Minute
	// fetchTimeout bounds a manifest read from the internal registry.
	fetchTimeout = 30 * time.Second
	// resultsDirName holds one JSON file per scan.
	resultsDirName = "scans"
	// cacheDirName is Trivy's cache, kept on the data volume so the
	// vulnerability database survives a restart.
	cacheDirName = "trivy"
)

// Scanner errors.
var (
	ErrQueueFull = errors.New("the scan queue is full")
	ErrNotFound  = errors.New("scan not found")
)

// State is a scan's lifecycle.
type State string

const (
	StateQueued    State = "queued"
	StateRunning   State = "running"
	StateSucceeded State = "succeeded"
	StateFailed    State = "failed"
)

// Severity counts, in the order the contract lists them.
type Summary struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
	Unknown  int `json:"unknown"`
}

// Vulnerability is one finding.
type Vulnerability struct {
	ID               string `json:"id"`
	PkgName          string `json:"pkgName"`
	InstalledVersion string `json:"installedVersion"`
	FixedVersion     string `json:"fixedVersion"`
	Severity         string `json:"severity"`
	Title            string `json:"title"`
	PrimaryURL       string `json:"primaryUrl"`
}

// Scan is one vulnerability scan with its findings.
type Scan struct {
	ID              string          `json:"id"`
	Repository      string          `json:"repository"`
	Reference       string          `json:"reference"`
	Digest          string          `json:"digest"`
	Platform        string          `json:"platform"`
	State           State           `json:"state"`
	QueuedAt        time.Time       `json:"queuedAt"`
	StartedAt       *time.Time      `json:"startedAt"`
	FinishedAt      *time.Time      `json:"finishedAt"`
	Error           *string         `json:"error"`
	Summary         Summary         `json:"summary"`
	Vulnerabilities []Vulnerability `json:"vulnerabilities"`

	// PlatformExplicit records whether the caller named the platform or took
	// the default. An explicitly named platform that the image does not match
	// is an error; the default silently follows the image. It is not part of
	// the response and not persisted: a scan that outlives a restart is marked
	// failed anyway.
	PlatformExplicit bool `json:"-"`
}

// Brief is a scan without its findings, as the list endpoint returns it.
type Brief struct {
	ID         string     `json:"id"`
	Repository string     `json:"repository"`
	Reference  string     `json:"reference"`
	Digest     string     `json:"digest"`
	Platform   string     `json:"platform"`
	State      State      `json:"state"`
	QueuedAt   time.Time  `json:"queuedAt"`
	StartedAt  *time.Time `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt"`
	Error      *string    `json:"error"`
	Summary    Summary    `json:"summary"`
}

// Brief drops the findings for a list response.
func (s Scan) Brief() Brief {
	return Brief{
		ID:         s.ID,
		Repository: s.Repository,
		Reference:  s.Reference,
		Digest:     s.Digest,
		Platform:   s.Platform,
		State:      s.State,
		QueuedAt:   s.QueuedAt,
		StartedAt:  s.StartedAt,
		FinishedAt: s.FinishedAt,
		Error:      s.Error,
		Summary:    s.Summary,
	}
}

func (s Scan) clone() Scan {
	copied := s
	copied.Vulnerabilities = slices.Clone(s.Vulnerabilities)
	return copied
}

// Request is one scan to run.
type Request struct {
	Repository string
	Reference  string
	Platform   string
}

// Scanner owns the queue, the worker and the stored results.
type Scanner struct {
	binary       string
	cacheDir     string
	resultsDir   string
	internalBase string
	client       *http.Client
	logger       *slog.Logger

	queue chan string

	mu      sync.Mutex
	scans   map[string]Scan
	ordered []string // scan ids, newest first
}

// Options configures a Scanner.
type Options struct {
	Binary       string
	DataDir      string
	InternalAddr string
	Logger       *slog.Logger
}

// New loads stored results and returns a Scanner. Start its worker with Run.
func New(opts Options) (*Scanner, error) {
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	resultsDir := filepath.Join(opts.DataDir, resultsDirName)
	mkdirErr := os.MkdirAll(resultsDir, 0o750)
	if mkdirErr != nil {
		return nil, fmt.Errorf("create scan results dir: %w", mkdirErr)
	}
	cacheDir := filepath.Join(opts.DataDir, cacheDirName)
	cacheErr := os.MkdirAll(cacheDir, 0o750)
	if cacheErr != nil {
		return nil, fmt.Errorf("create trivy cache dir: %w", cacheErr)
	}

	s := &Scanner{
		binary:       opts.Binary,
		cacheDir:     cacheDir,
		resultsDir:   resultsDir,
		internalBase: "http://" + opts.InternalAddr,
		client:       &http.Client{Timeout: fetchTimeout},
		logger:       logger,
		queue:        make(chan string, queueCapacity),
		scans:        make(map[string]Scan),
	}
	loadErr := s.load()
	if loadErr != nil {
		return nil, loadErr
	}
	return s, nil
}

// Submit queues a scan and returns it in its queued state.
func (s *Scanner) Submit(request Request) (Scan, error) {
	now := time.Now().UTC()
	platform := strings.TrimSpace(request.Platform)
	explicit := platform != ""
	if !explicit {
		platform = DefaultPlatform
	}

	record := Scan{
		ID:               newID(now),
		Repository:       request.Repository,
		Reference:        request.Reference,
		Platform:         platform,
		State:            StateQueued,
		QueuedAt:         now,
		Vulnerabilities:  make([]Vulnerability, 0),
		PlatformExplicit: explicit,
	}

	s.mu.Lock()
	s.scans[record.ID] = record
	updated := make([]string, 0, len(s.ordered)+1)
	updated = append(updated, record.ID)
	updated = append(updated, s.ordered...)
	s.ordered = updated
	s.mu.Unlock()

	select {
	case s.queue <- record.ID:
	default:
		s.mu.Lock()
		delete(s.scans, record.ID)
		s.ordered = slices.Delete(s.ordered, 0, 1)
		s.mu.Unlock()
		return Scan{}, ErrQueueFull
	}

	persistErr := s.persist(record)
	if persistErr != nil {
		s.logger.Error("could not persist queued scan", "scan", record.ID, "error", persistErr)
	}
	return record, nil
}

// Get returns one scan with its findings.
func (s *Scanner) Get(id string) (Scan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, ok := s.scans[id]
	if !ok {
		return Scan{}, ErrNotFound
	}
	return record.clone(), nil
}

// List returns the most recent scans for a reference, newest first.
func (s *Scanner) List(repository, reference string) []Brief {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]Brief, 0, listLimit)
	for _, id := range s.ordered {
		record, ok := s.scans[id]
		if !ok {
			continue
		}
		if repository != "" && record.Repository != repository {
			continue
		}
		if reference != "" && record.Reference != reference {
			continue
		}
		out = append(out, record.Brief())
		if len(out) == listLimit {
			break
		}
	}
	return out
}

// Run is the worker: it takes one scan at a time until ctx is cancelled.
func (s *Scanner) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-s.queue:
			s.execute(ctx, id)
		}
	}
}

func (s *Scanner) execute(ctx context.Context, id string) {
	defer func() {
		recovered := recover()
		if recovered == nil {
			return
		}
		s.logger.Error("scan panicked", "scan", id, "panic", recovered)
		message := fmt.Sprintf("internal error: %v", recovered)
		s.fail(id, message)
	}()

	record, getErr := s.Get(id)
	if getErr != nil {
		s.logger.Error("queued scan disappeared", "scan", id, "error", getErr)
		return
	}

	startedAt := time.Now().UTC()
	record.State = StateRunning
	record.StartedAt = &startedAt
	s.update(record)

	target, resolveErr := s.resolve(ctx, record.Repository, record.Reference,
		record.Platform, record.PlatformExplicit)
	if resolveErr != nil {
		s.fail(id, resolveErr.Error())
		return
	}
	record.Digest = target.digest
	record.Platform = target.platform
	s.update(record)

	findings, runErr := s.runTrivy(ctx, record.Repository, target.digest)
	if runErr != nil {
		s.fail(id, runErr.Error())
		return
	}

	finishedAt := time.Now().UTC()
	record.State = StateSucceeded
	record.FinishedAt = &finishedAt
	record.Vulnerabilities = findings
	record.Summary = summarise(findings)
	s.update(record)
	s.logger.Info("scan finished",
		"scan", id,
		"repository", record.Repository,
		"reference", record.Reference,
		"critical", record.Summary.Critical,
		"high", record.Summary.High)
}
