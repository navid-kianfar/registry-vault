// Package supervisor runs a child process for the lifetime of the agent:
// it restarts it with backoff when it exits on its own, forwards SIGTERM on
// shutdown, and reports what the management API needs to show.
package supervisor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

const (
	// minBackoff is the pause before the first restart.
	minBackoff = 1 * time.Second
	// maxBackoff caps the pause between restarts.
	maxBackoff = 30 * time.Second
	// healthyRunTime is how long a child must run before its next crash
	// starts the backoff over from minBackoff.
	healthyRunTime = 60 * time.Second
	// gracePeriod is how long a child gets after SIGTERM before SIGKILL.
	gracePeriod = 15 * time.Second
)

// Exit is how a child last ended.
type Exit struct {
	Code int       `json:"code"`
	At   time.Time `json:"at"`
}

// Status is the child's state as GET /api/v1/health reports it.
type Status struct {
	Running   bool       `json:"running"`
	PID       int        `json:"pid"`
	StartedAt *time.Time `json:"startedAt"`
	Restarts  int        `json:"restarts"`
	LastExit  *Exit      `json:"lastExit"`
}

// Process supervises one child command.
//
// The child inherits an environment the caller built, and for the extra
// command in the all-in-one image that includes AGENT_API_KEY — Registry Vault
// needs it to reach the management API. Neither that environment nor the
// command line is ever logged: every line below carries the process name, its
// pid and a duration, and nothing else. Do not add "argv" or "env" to one.
type Process struct {
	name    string
	argv    []string
	env     []string
	output  io.Writer
	logger  *slog.Logger
	restart chan struct{}

	mu     sync.Mutex
	status Status
}

// New returns a supervisor for argv. env is the child's complete environment.
// output receives its stdout and stderr.
func New(name string, argv, env []string, output io.Writer, logger *slog.Logger) (*Process, error) {
	if len(argv) == 0 {
		return nil, fmt.Errorf("supervisor %s: empty command", name)
	}
	p := &Process{
		name:    name,
		argv:    argv,
		env:     env,
		output:  output,
		logger:  logger,
		restart: make(chan struct{}, 1),
	}
	return p, nil
}

// ShellCommand turns a configured command line into an argv that keeps signal
// delivery intact: sh execs the command, so it does not sit between the agent
// and the real process.
func ShellCommand(commandLine string) []string {
	argv := make([]string, 3)
	argv[0] = "/bin/sh"
	argv[1] = "-c"
	argv[2] = "exec " + commandLine
	return argv
}

// Status returns a snapshot of the child's state.
func (p *Process) Status() Status {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.status
}

// Restart asks the supervisor to stop the current child; the run loop starts a
// new one immediately. It never blocks.
func (p *Process) Restart() {
	select {
	case p.restart <- struct{}{}:
	default:
	}
}

// Run supervises the child until ctx is cancelled and the child has exited.
// It is the goroutine's whole life: start it once and wait for it to return.
func (p *Process) Run(ctx context.Context) {
	backoff := minBackoff

	for {
		if ctx.Err() != nil {
			return
		}

		startedAt := time.Now()
		exitErr := p.runOnce(ctx)
		ranFor := time.Since(startedAt)

		if ctx.Err() != nil {
			return
		}
		if exitErr != nil {
			p.logger.Warn("child exited", "process", p.name, "error", exitErr, "ranFor", ranFor.String())
		} else {
			p.logger.Warn("child exited", "process", p.name, "ranFor", ranFor.String())
		}

		if ranFor >= healthyRunTime {
			backoff = minBackoff
		}
		wait := backoff
		if p.takeRestartRequest() {
			wait = 0
		}
		if wait > 0 {
			p.logger.Info("restarting child", "process", p.name, "in", wait.String())
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-p.restart:
				timer.Stop()
			case <-timer.C:
			}
		}
		backoff = nextBackoff(backoff)
	}
}

// runOnce starts the child and returns when it has exited, whether on its own,
// because ctx was cancelled, or because a restart was requested.
func (p *Process) runOnce(ctx context.Context) error {
	cmd := exec.Command(p.argv[0], p.argv[1:]...)
	cmd.Env = p.env
	cmd.Stdout = p.output
	cmd.Stderr = p.output
	// Its own process group, so a signal reaches the child and anything it
	// spawned, and so the agent's terminal signals do not hit it twice.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	startErr := cmd.Start()
	if startErr != nil {
		p.recordStartFailure()
		return fmt.Errorf("start %s: %w", p.name, startErr)
	}
	p.recordStarted(cmd)
	p.logger.Info("child started", "process", p.name, "pid", cmd.Process.Pid)

	waitResult := make(chan error, 1)
	go func() {
		waitResult <- cmd.Wait()
	}()

	select {
	case err := <-waitResult:
		p.recordExit(cmd)
		flush(p.output)
		return err
	case <-ctx.Done():
		p.logger.Info("stopping child", "process", p.name)
		err := p.terminate(cmd, waitResult)
		p.recordExit(cmd)
		flush(p.output)
		return err
	case <-p.restart:
		p.logger.Info("restart requested", "process", p.name)
		err := p.terminate(cmd, waitResult)
		p.recordExit(cmd)
		flush(p.output)
		p.requestRestart()
		return err
	}
}

// terminate sends SIGTERM to the child's process group, then SIGKILL if it has
// not gone after gracePeriod.
func (p *Process) terminate(cmd *exec.Cmd, waitResult <-chan error) error {
	signalErr := signalGroup(cmd, syscall.SIGTERM)
	if signalErr != nil {
		p.logger.Warn("could not signal child", "process", p.name, "error", signalErr)
	}

	timer := time.NewTimer(gracePeriod)
	defer timer.Stop()

	select {
	case err := <-waitResult:
		return err
	case <-timer.C:
		p.logger.Warn("child did not stop, killing", "process", p.name)
		_ = signalGroup(cmd, syscall.SIGKILL)
		return <-waitResult
	}
}

// flush pushes a child's last partial line into the log ring. A process that
// dies mid-line is exactly the one whose last line matters.
func flush(output io.Writer) {
	flusher, ok := output.(interface{ Flush() })
	if !ok {
		return
	}
	flusher.Flush()
}

func signalGroup(cmd *exec.Cmd, sig syscall.Signal) error {
	if cmd.Process == nil {
		return errors.New("process is not running")
	}
	pid := cmd.Process.Pid
	groupErr := syscall.Kill(-pid, sig)
	if groupErr == nil {
		return nil
	}
	// The group may already be gone; fall back to the process itself.
	directErr := cmd.Process.Signal(sig)
	if directErr != nil {
		return fmt.Errorf("signal %s: %w", sig, directErr)
	}
	return nil
}

func (p *Process) recordStarted(cmd *exec.Cmd) {
	now := time.Now().UTC()

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.status.StartedAt != nil {
		p.status.Restarts++
	}
	p.status.Running = true
	p.status.PID = cmd.Process.Pid
	p.status.StartedAt = &now
}

func (p *Process) recordStartFailure() {
	now := time.Now().UTC()

	p.mu.Lock()
	defer p.mu.Unlock()

	p.status.Running = false
	p.status.PID = 0
	p.status.LastExit = &Exit{Code: -1, At: now}
}

func (p *Process) recordExit(cmd *exec.Cmd) {
	now := time.Now().UTC()
	code := -1
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	p.status.Running = false
	p.status.PID = 0
	p.status.LastExit = &Exit{Code: code, At: now}
}

func (p *Process) requestRestart() {
	select {
	case p.restart <- struct{}{}:
	default:
	}
}

func (p *Process) takeRestartRequest() bool {
	select {
	case <-p.restart:
		return true
	default:
		return false
	}
}

func nextBackoff(current time.Duration) time.Duration {
	doubled := current * 2
	if doubled > maxBackoff {
		return maxBackoff
	}
	return doubled
}

// Environ builds a child environment from the agent's own: variables in drop
// are removed, then overrides are applied, so they win. The registry child in
// particular must not inherit the agent's own REGISTRY_* control variables —
// Distribution reads REGISTRY_<SECTION>_… as config overrides and would choke
// on them.
func Environ(overrides map[string]string, drop []string) []string {
	base := os.Environ()
	dropped := make(map[string]struct{}, len(drop))
	for _, name := range drop {
		dropped[name] = struct{}{}
	}

	out := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		name, _, found := cutEnv(entry)
		if found {
			_, overridden := overrides[name]
			if overridden {
				continue
			}
			_, removed := dropped[name]
			if removed {
				continue
			}
		}
		out = append(out, entry)
	}
	for name, value := range overrides {
		out = append(out, name+"="+value)
	}
	return out
}

func cutEnv(entry string) (string, string, bool) {
	for index := 0; index < len(entry); index++ {
		if entry[index] == '=' {
			return entry[:index], entry[index+1:], true
		}
	}
	return entry, "", false
}
