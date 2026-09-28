// Package gcjob runs the registry's garbage collector under the write gate and
// keeps a persisted history of the jobs.
//
// The collector is always run with --delete-untagged. Without it, deleting a
// multi-arch image frees nothing: the index is gone but its platform manifests
// stay referenced. That flag is only safe from registry 3 onwards — on
// registry 2 it deletes the platform manifests of images that are still
// tagged — so this package refuses to run against an older binary.
package gcjob

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/atomicio"
	"github.com/navid-kianfar/registry-vault/agent/internal/gate"
	"github.com/navid-kianfar/registry-vault/agent/internal/storage"
)

const (
	// historyFile holds the persisted jobs inside the data directory.
	historyFile = "gc-jobs.json"
	// historyLimit is how many jobs are kept.
	historyLimit = 20
	// outputLimit is how many lines of collector output a job keeps.
	outputLimit = 200
	// drainTimeout is how long a job waits for in-flight writes before it
	// starts anyway.
	drainTimeout = 60 * time.Second
	// minimumMajor is the lowest registry major version --delete-untagged is
	// safe on.
	minimumMajor = 3
	// gateReason is what a blocked client is told while a job runs.
	gateReason = "garbage collection"
	// emptyRepositoryQuietPeriod is how long a stripped repository must have
	// been untouched before the sweep removes its directory. The write gate
	// drains in-flight requests, not an in-flight push: between a push's last
	// blob and its manifest PUT the repository has layer links and no
	// manifests, which is indistinguishable from a collected one except by
	// how recently those links were written.
	emptyRepositoryQuietPeriod = time.Hour
)

// Runner errors.
var (
	ErrAlreadyRunning = errors.New("a garbage collection is already running")
	ErrUnsupported    = errors.New("garbage collection needs registry 3 or newer")
	ErrNoJob          = errors.New("no garbage collection has run yet")
)

// State is a job's lifecycle.
type State string

const (
	StateQueued    State = "queued"
	StateRunning   State = "running"
	StateSucceeded State = "succeeded"
	StateFailed    State = "failed"
)

// Job is one garbage collection, as the management API reports it.
type Job struct {
	ID               string     `json:"id"`
	State            State      `json:"state"`
	DryRun           bool       `json:"dryRun"`
	StartedAt        *time.Time `json:"startedAt"`
	FinishedAt       *time.Time `json:"finishedAt"`
	UsedBytesBefore  int64      `json:"usedBytesBefore"`
	UsedBytesAfter   int64      `json:"usedBytesAfter"`
	FreedBytes       int64      `json:"freedBytes"`
	BlobsDeleted     int        `json:"blobsDeleted"`
	ManifestsDeleted int        `json:"manifestsDeleted"`
	Error            *string    `json:"error"`
	Output           []string   `json:"output"`
}

// Runner owns garbage collection: one job at a time, history on disk.
type Runner struct {
	binary      string
	configPath  string
	historyPath string
	env         []string
	store       *storage.Store
	gate        *gate.Gate
	logger      *slog.Logger
	baseCtx     context.Context

	mu      sync.Mutex
	running bool
	current *Job
	history []Job
	version string
	waiting sync.WaitGroup
}

// Options configures a Runner.
type Options struct {
	Binary     string
	ConfigPath string
	DataDir    string
	// Env is the environment the registry binary runs with. It must be the
	// same sanitised environment the supervised registry gets: Distribution
	// reads REGISTRY_<SECTION>_… as configuration overrides, so the agent's own
	// REGISTRY_STORAGE_ROOT or REGISTRY_AUTH would stop it parsing its config.
	Env     []string
	Store   *storage.Store
	Gate    *gate.Gate
	Logger  *slog.Logger
	BaseCtx context.Context
}

// New loads the persisted history and returns a Runner.
func New(opts Options) (*Runner, error) {
	if opts.Store == nil || opts.Gate == nil {
		return nil, errors.New("gcjob: store and gate are required")
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	base := opts.BaseCtx
	if base == nil {
		base = context.Background()
	}

	r := &Runner{
		binary:      opts.Binary,
		configPath:  opts.ConfigPath,
		historyPath: filepath.Join(opts.DataDir, historyFile),
		env:         opts.Env,
		store:       opts.Store,
		gate:        opts.Gate,
		logger:      logger,
		baseCtx:     base,
	}

	var stored []Job
	_, readErr := atomicio.ReadJSON(r.historyPath, &stored)
	if readErr != nil {
		return nil, fmt.Errorf("load gc history: %w", readErr)
	}
	// A job that was running when the agent stopped never finished; it must not
	// come back as "running" and block the next one.
	for index, job := range stored {
		if job.State == StateRunning || job.State == StateQueued {
			stored[index] = markInterrupted(job)
		}
	}
	r.history = stored
	if len(stored) > 0 {
		newest := stored[0]
		r.current = &newest
	}
	return r, nil
}

// RegistryVersion returns the version the registry binary reports, detecting it
// once and caching it.
func (r *Runner) RegistryVersion() (string, error) {
	r.mu.Lock()
	cached := r.version
	r.mu.Unlock()

	if cached != "" {
		return cached, nil
	}
	detected, err := detectVersion(r.baseCtx, r.binary, r.env)
	if err != nil {
		return "", err
	}

	r.mu.Lock()
	r.version = detected
	r.mu.Unlock()
	return detected, nil
}

// State reports whether a job is running, for GET /api/v1/health.
func (r *Runner) State() string {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.running {
		return string(StateRunning)
	}
	return "idle"
}

// Running reports whether a job is in progress.
func (r *Runner) Running() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.running
}

// Current returns the running job, or the most recent one.
func (r *Runner) Current() (Job, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.current == nil {
		return Job{}, ErrNoJob
	}
	return r.current.clone(), nil
}

// History returns the most recent jobs, newest first.
func (r *Runner) History() []Job {
	r.mu.Lock()
	defer r.mu.Unlock()

	out := make([]Job, len(r.history))
	for index, job := range r.history {
		out[index] = job.clone()
	}
	return out
}

// Start begins a job and returns it in its queued state. Only one job runs at a
// time.
func (r *Runner) Start(dryRun bool) (Job, error) {
	version, versionErr := r.RegistryVersion()
	if versionErr != nil {
		return Job{}, versionErr
	}
	major, majorErr := majorVersion(version)
	if majorErr != nil {
		return Job{}, majorErr
	}
	if major < minimumMajor {
		return Job{}, fmt.Errorf("%w: this registry reports %s, and --delete-untagged deletes "+
			"platform manifests of still-tagged images before version 3", ErrUnsupported, version)
	}

	now := time.Now().UTC()
	job := Job{
		ID:     "gc_" + now.Format("20060102T150405Z"),
		State:  StateQueued,
		DryRun: dryRun,
		Output: make([]string, 0),
	}

	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return Job{}, ErrAlreadyRunning
	}
	r.running = true
	r.current = &job
	r.mu.Unlock()

	r.waiting.Add(1)
	go r.run(job)
	return job, nil
}

// Wait blocks until a running job has finished. Shutdown calls it.
func (r *Runner) Wait() {
	r.waiting.Wait()
}

// run executes one job. Whatever happens — including a panic — the write gate
// is reopened and the job leaves the running state.
func (r *Runner) run(job Job) {
	defer r.waiting.Done()

	defer func() {
		recovered := recover()
		if recovered == nil {
			return
		}
		r.logger.Error("garbage collection panicked", "job", job.ID, "panic", recovered)
		message := fmt.Sprintf("internal error: %v", recovered)
		job.Error = &message
		r.finish(job, StateFailed)
	}()

	startedAt := time.Now().UTC()
	job.StartedAt = &startedAt
	job.State = StateRunning
	r.publish(job)

	if !job.DryRun {
		release, drained := r.gate.Hold(gateReason, drainTimeout)
		defer release()
		if !drained {
			r.logger.Warn("garbage collection starting with writes still in flight", "job", job.ID)
		}
	}

	before, beforeErr := r.store.UsedBytes()
	if beforeErr != nil {
		r.logger.Warn("could not measure storage before gc", "job", job.ID, "error", beforeErr)
	}
	job.UsedBytesBefore = before

	output, runErr := r.execute(job.DryRun)
	job.Output = tail(output, outputLimit)
	blobs, manifests := parseCounts(output)
	job.BlobsDeleted = blobs
	job.ManifestsDeleted = manifests

	if runErr != nil {
		message := runErr.Error()
		job.Error = &message
		job.UsedBytesAfter = before
		r.finish(job, StateFailed)
		return
	}

	if job.DryRun {
		job.UsedBytesAfter = before
		job.FreedBytes = r.estimateFreed(output)
		r.finish(job, StateSucceeded)
		return
	}

	r.removeEmptyRepositories(job.ID)
	r.store.Invalidate()

	after, afterErr := r.store.UsedBytes()
	if afterErr != nil {
		r.logger.Warn("could not measure storage after gc", "job", job.ID, "error", afterErr)
		after = before
	}
	job.UsedBytesAfter = after
	freed := before - after
	if freed < 0 {
		freed = 0
	}
	job.FreedBytes = freed
	r.finish(job, StateSucceeded)
}

func (r *Runner) execute(dryRun bool) ([]string, error) {
	args := make([]string, 0, 4)
	args = append(args, "garbage-collect", "--delete-untagged")
	if dryRun {
		args = append(args, "--dry-run")
	}
	args = append(args, r.configPath)

	cmd := exec.CommandContext(r.baseCtx, r.binary, args...)
	cmd.Env = r.env
	var combined bytes.Buffer
	cmd.Stdout = &combined
	cmd.Stderr = &combined

	runErr := cmd.Run()
	text := combined.String()
	lines := splitLines(text)
	if runErr != nil {
		return lines, fmt.Errorf("registry garbage-collect: %w", runErr)
	}
	return lines, nil
}

// removeEmptyRepositories drops repository directories the collector left with
// no tags and no manifests, so the registry stops listing them. A repository
// with a leftover upload or a recently written file is left alone: it may be a
// push that the gate could not drain.
func (r *Runner) removeEmptyRepositories(jobID string) {
	empty, listErr := r.store.EmptyRepositories(emptyRepositoryQuietPeriod)
	if listErr != nil {
		r.logger.Warn("could not list empty repositories", "job", jobID, "error", listErr)
		return
	}
	for _, name := range empty {
		removeErr := r.store.RemoveRepository(name, true)
		if removeErr != nil {
			r.logger.Warn("could not remove empty repository", "job", jobID, "repository", name, "error", removeErr)
			continue
		}
		r.logger.Info("removed empty repository", "job", jobID, "repository", name)
	}
}

// estimateFreed sums the sizes of the blobs a dry run named.
func (r *Runner) estimateFreed(output []string) int64 {
	var total int64
	seen := make(map[string]struct{}, len(output))
	for _, line := range output {
		digest, found := blobDigest(line)
		if !found {
			continue
		}
		_, already := seen[digest]
		if already {
			continue
		}
		seen[digest] = struct{}{}
		size, exists := r.store.BlobSize(digest)
		if exists {
			total += size
		}
	}
	return total
}

func (r *Runner) publish(job Job) {
	r.mu.Lock()
	defer r.mu.Unlock()

	snapshot := job.clone()
	r.current = &snapshot
}

// finish records the job's terminal state and persists the history.
func (r *Runner) finish(job Job, state State) {
	finishedAt := time.Now().UTC()
	job.FinishedAt = &finishedAt
	job.State = state

	r.mu.Lock()
	snapshot := job.clone()
	r.current = &snapshot
	r.running = false
	updated := make([]Job, 0, len(r.history)+1)
	updated = append(updated, job.clone())
	updated = append(updated, r.history...)
	if len(updated) > historyLimit {
		updated = updated[:historyLimit]
	}
	r.history = updated
	persisted := slices.Clone(updated)
	r.mu.Unlock()

	writeErr := atomicio.WriteJSON(r.historyPath, persisted)
	if writeErr != nil {
		r.logger.Error("could not persist gc history", "job", job.ID, "error", writeErr)
	}
	if state == StateFailed && job.Error != nil {
		r.logger.Error("garbage collection failed", "job", job.ID, "error", *job.Error)
		return
	}
	r.logger.Info("garbage collection finished",
		"job", job.ID,
		"dryRun", job.DryRun,
		"freedBytes", job.FreedBytes,
		"blobsDeleted", job.BlobsDeleted,
		"manifestsDeleted", job.ManifestsDeleted)
}

func (j Job) clone() Job {
	copied := j
	copied.Output = slices.Clone(j.Output)
	return copied
}

func markInterrupted(job Job) Job {
	message := "interrupted: the agent stopped while this job was running"
	job.State = StateFailed
	job.Error = &message
	if job.FinishedAt == nil {
		job.FinishedAt = job.StartedAt
	}
	return job
}

// summaryPattern is the collector's own closing line, which is the most
// reliable source for the counts.
var summaryPattern = regexp.MustCompile(`(\d+) blobs marked, (\d+) blobs and (\d+) manifests eligible for deletion`)

// A collector line names the blob either by digest or by its path in the
// storage tree, which repeats the first two hex characters as a directory.
var (
	digestPattern   = regexp.MustCompile(`sha256:([0-9a-f]{64})`)
	blobPathPattern = regexp.MustCompile(`sha256/[0-9a-f]{2}/([0-9a-f]{64})`)
)

// parseCounts reads the collector's summary line, falling back to counting the
// per-item lines when the wording changes.
func parseCounts(output []string) (blobs, manifests int) {
	for _, line := range output {
		match := summaryPattern.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		parsedBlobs, blobErr := strconv.Atoi(match[2])
		parsedManifests, manifestErr := strconv.Atoi(match[3])
		if blobErr == nil && manifestErr == nil {
			return parsedBlobs, parsedManifests
		}
	}

	for _, line := range output {
		switch {
		case strings.Contains(line, "blob eligible for deletion"):
			blobs++
		case strings.Contains(line, "manifest eligible for deletion"):
			manifests++
		}
	}
	return blobs, manifests
}

// blobDigest pulls a blob digest out of a collector line, which names either
// the digest or the blob's path.
func blobDigest(line string) (string, bool) {
	if !strings.Contains(line, "blob eligible for deletion") {
		return "", false
	}
	pathMatch := blobPathPattern.FindStringSubmatch(line)
	if pathMatch != nil {
		return "sha256:" + pathMatch[1], true
	}
	digestMatch := digestPattern.FindStringSubmatch(line)
	if digestMatch == nil {
		return "", false
	}
	return "sha256:" + digestMatch[1], true
}

func splitLines(text string) []string {
	trimmed := strings.TrimRight(text, "\n")
	if trimmed == "" {
		return make([]string, 0)
	}
	raw := strings.Split(trimmed, "\n")
	out := make([]string, len(raw))
	for index, line := range raw {
		out[index] = strings.TrimRight(line, "\r")
	}
	return out
}

func tail(lines []string, limit int) []string {
	if len(lines) <= limit {
		return slices.Clone(lines)
	}
	return slices.Clone(lines[len(lines)-limit:])
}

var versionPattern = regexp.MustCompile(`(\d+)\.(\d+)\.(\d+)`)

// detectVersion asks the registry binary for its version. Distribution 2 takes
// a --version flag and 3 has a version subcommand, so both are tried.
func detectVersion(ctx context.Context, binary string, env []string) (string, error) {
	attempts := [...][]string{{"--version"}, {"version"}}
	problems := make([]error, 0, len(attempts))

	for _, args := range attempts {
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Env = env
		output, runErr := cmd.CombinedOutput()
		text := string(output)
		if runErr != nil {
			problems = append(problems, fmt.Errorf("%s %s: %w", binary, args[0], runErr))
			continue
		}
		match := versionPattern.FindString(text)
		if match == "" {
			trimmed := strings.TrimSpace(text)
			problems = append(problems, fmt.Errorf("%s %s: no version in %q", binary, args[0], trimmed))
			continue
		}
		return match, nil
	}
	return "", errors.Join(problems...)
}

func majorVersion(version string) (int, error) {
	match := versionPattern.FindStringSubmatch(version)
	if match == nil {
		return 0, fmt.Errorf("%w: cannot read a version from %q", ErrUnsupported, version)
	}
	major, convErr := strconv.Atoi(match[1])
	if convErr != nil {
		return 0, fmt.Errorf("%w: %v", ErrUnsupported, convErr)
	}
	return major, nil
}
