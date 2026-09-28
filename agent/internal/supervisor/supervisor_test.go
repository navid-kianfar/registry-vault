package supervisor

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/logbuf"
)

// safeBuffer collects the agent's own log output while the supervisor writes
// to it from its goroutine.
type safeBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (s *safeBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buffer.Write(p)
}

func (s *safeBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buffer.String()
}

type harness struct {
	process *Process
	ring    *logbuf.Ring
	logs    *safeBuffer
	stop    context.CancelFunc
	done    chan struct{}
}

func start(t *testing.T, commandLine string, overrides map[string]string) *harness {
	t.Helper()

	ring := logbuf.NewRing()
	output := logbuf.NewWriter(ring, nil)
	logs := &safeBuffer{}
	handler := slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})
	logger := slog.New(handler)

	argv := ShellCommand(commandLine)
	env := Environ(overrides, nil)
	process, err := New("extra", argv, env, output, logger)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		process.Run(ctx)
	}()

	h := &harness{process: process, ring: ring, logs: logs, stop: cancel, done: done}
	t.Cleanup(h.shutdown)
	return h
}

func (h *harness) shutdown() {
	h.stop()
	select {
	case <-h.done:
	case <-time.After(30 * time.Second):
		panic("supervisor did not stop")
	}
}

// waitForRunning polls until the supervisor reports a live child.
func (h *harness) waitForRunning(t *testing.T) {
	t.Helper()

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if h.process.Status().Running {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("the child never started: %+v", h.process.Status())
}

// waitForLine polls the child's captured output for a line containing want.
func (h *harness) waitForLine(t *testing.T, want string) string {
	t.Helper()

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		for _, line := range h.ring.Last(logbuf.Capacity) {
			if strings.Contains(line, want) {
				return line
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no line containing %q; captured: %v", want, h.ring.Last(20))
	return ""
}

// The extra command is Registry Vault in the all-in-one image, and it needs
// AGENT_API_KEY to talk to the management API. It inherits the agent's
// environment — but the agent itself must never write that environment
// anywhere, or the key would land in the log ring and in `docker logs`.
func TestTheChildInheritsTheEnvironmentButItIsNeverLogged(t *testing.T) {
	const secret = "a-management-key-long-enough"

	// ShellCommand execs the command, so a multi-step script goes to an inner
	// shell rather than relying on the outer one to stay around.
	h := start(t, `sh -c 'echo "key is ${AGENT_API_KEY:+present}"; sleep 30'`,
		map[string]string{"AGENT_API_KEY": secret})

	line := h.waitForLine(t, "key is")
	if !strings.Contains(line, "present") {
		t.Fatalf("child output = %q, want the child to see AGENT_API_KEY", line)
	}

	// Let the supervisor log its start and stop lines, then read everything.
	h.shutdown()

	agentLog := h.logs.String()
	if strings.Contains(agentLog, secret) {
		t.Fatalf("the agent logged the child's environment:\n%s", agentLog)
	}
	for _, captured := range h.ring.Last(logbuf.Capacity) {
		if strings.Contains(captured, secret) {
			t.Fatalf("the log ring captured the secret: %q", captured)
		}
	}
	if !strings.Contains(agentLog, "child started") {
		t.Fatalf("expected the supervisor to log the start:\n%s", agentLog)
	}
}

// A command line may itself carry a credential, so it is never logged either.
func TestTheCommandLineIsNeverLogged(t *testing.T) {
	const secretArgument = "--token=super-secret-value"

	h := start(t, `sh -c 'sleep 30' `+secretArgument, nil)
	h.waitForRunning(t)
	h.shutdown()

	agentLog := h.logs.String()
	if strings.Contains(agentLog, "super-secret-value") {
		t.Fatalf("the agent logged the child's command line:\n%s", agentLog)
	}
}

func TestStatusReportsTheRunningChild(t *testing.T) {
	h := start(t, `sh -c 'echo ready; sleep 30'`, nil)
	h.waitForLine(t, "ready")

	status := h.process.Status()
	if !status.Running || status.PID == 0 || status.StartedAt == nil {
		t.Fatalf("status = %+v, want a running child", status)
	}
	if status.Restarts != 0 || status.LastExit != nil {
		t.Fatalf("status = %+v, want a first run", status)
	}

	h.shutdown()
	stopped := h.process.Status()
	if stopped.Running || stopped.LastExit == nil {
		t.Fatalf("status = %+v, want a stopped child with an exit", stopped)
	}
}

// A child that exits on its own comes back, and the agent counts it.
func TestAChildThatExitsIsRestarted(t *testing.T) {
	h := start(t, `sh -c 'exit 3'`, nil)

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		status := h.process.Status()
		if status.Restarts >= 1 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("the child was not restarted: %+v", h.process.Status())
}

func TestEnvironDropsAndOverrides(t *testing.T) {
	overrides := map[string]string{"REGISTRY_HTTP_ADDR": "127.0.0.1:5001"}
	drop := []string{"REGISTRY_STORAGE_ROOT"}

	t.Setenv("REGISTRY_STORAGE_ROOT", "/var/lib/registry")
	t.Setenv("REGISTRY_HTTP_ADDR", "0.0.0.0:9999")
	t.Setenv("KEEP_ME", "yes")

	env := Environ(overrides, drop)

	found := make(map[string]string, len(env))
	for _, entry := range env {
		name, value, _ := strings.Cut(entry, "=")
		found[name] = value
	}

	_, dropped := found["REGISTRY_STORAGE_ROOT"]
	if dropped {
		t.Fatal("REGISTRY_STORAGE_ROOT must not reach the registry: it reads it as a storage driver")
	}
	if found["REGISTRY_HTTP_ADDR"] != "127.0.0.1:5001" {
		t.Fatalf("REGISTRY_HTTP_ADDR = %q, want the override to win", found["REGISTRY_HTTP_ADDR"])
	}
	if found["KEEP_ME"] != "yes" {
		t.Fatal("unrelated variables must pass through")
	}

	// The override must appear exactly once, or the child sees both values.
	occurrences := 0
	for _, entry := range env {
		if strings.HasPrefix(entry, "REGISTRY_HTTP_ADDR=") {
			occurrences++
		}
	}
	if occurrences != 1 {
		t.Fatalf("REGISTRY_HTTP_ADDR appears %d times, want 1", occurrences)
	}
}

func TestShellCommandExecsSoSignalsReachTheRealProcess(t *testing.T) {
	argv := ShellCommand("node server.js")

	if len(argv) != 3 || argv[0] != "/bin/sh" || argv[1] != "-c" {
		t.Fatalf("argv = %v, want a shell invocation", argv)
	}
	if !strings.HasPrefix(argv[2], "exec ") {
		t.Fatalf("argv[2] = %q, want it to exec so the shell does not sit between the agent and the child", argv[2])
	}
}
