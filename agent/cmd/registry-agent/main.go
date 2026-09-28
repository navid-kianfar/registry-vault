// Command registry-agent supervises a CNCF Distribution registry, fronts it
// with an authenticating reverse proxy, and serves the management API that the
// Registry HTTP API does not provide.
//
// The contract it implements is agent/API.md.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/api"
	"github.com/navid-kianfar/registry-vault/agent/internal/config"
	"github.com/navid-kianfar/registry-vault/agent/internal/events"
	"github.com/navid-kianfar/registry-vault/agent/internal/gate"
	"github.com/navid-kianfar/registry-vault/agent/internal/gcjob"
	"github.com/navid-kianfar/registry-vault/agent/internal/logbuf"
	"github.com/navid-kianfar/registry-vault/agent/internal/proxy"
	"github.com/navid-kianfar/registry-vault/agent/internal/scan"
	"github.com/navid-kianfar/registry-vault/agent/internal/storage"
	"github.com/navid-kianfar/registry-vault/agent/internal/supervisor"
	"github.com/navid-kianfar/registry-vault/agent/internal/users"
)

// version is the agent's own version, overridable at build time with
// -ldflags "-X main.version=…".
var version = "1.0.0"

const (
	// dataDirPerm is the mode of the agent's data directory.
	dataDirPerm = 0o750
	// shutdownTimeout bounds the graceful stop of both HTTP servers.
	shutdownTimeout = 20 * time.Second
	// readHeaderTimeout keeps a slow-header client from holding a connection.
	// No read or write timeout is set: a blob transfer is minutes long.
	readHeaderTimeout = 30 * time.Second
	// idleTimeout closes idle keep-alive connections.
	idleTimeout = 120 * time.Second
	// eventPruneInterval is how often the event log is trimmed.
	eventPruneInterval = 1 * time.Hour
	// defaultRegistryBinary is the registry executable, overridable with
	// REGISTRY_BINARY.
	defaultRegistryBinary = "registry"
)

// registryOnlyEnv are the agent's own variables. Distribution reads
// REGISTRY_<SECTION>_… as configuration overrides, so the child must not see
// them: REGISTRY_AUTH alone would make it fail to start.
var registryOnlyEnv = []string{
	"AGENT_API_KEY",
	"AGENT_LISTEN",
	"AGENT_API_LISTEN",
	"AGENT_DATA_DIR",
	"AGENT_SERVICE_USER",
	"AGENT_EXTRA_COMMAND",
	"AGENT_GC_RETRY_AFTER",
	"AGENT_EVENT_RETENTION_DAYS",
	"AGENT_LOG_LEVEL",
	"REGISTRY_CONFIG",
	"REGISTRY_STORAGE_ROOT",
	"REGISTRY_INTERNAL_ADDR",
	"REGISTRY_AUTH",
	"REGISTRY_HTPASSWD_IMPORT",
	"REGISTRY_BINARY",
	"TRIVY_ENABLED",
}

func main() {
	code := run()
	os.Exit(code)
}

func run() int {
	agentRing := logbuf.NewRing()
	agentOutput := logbuf.NewWriter(agentRing, os.Stdout)

	// A bootstrap logger so configuration problems are reported in the same
	// shape as everything else.
	bootstrap := newLogger(agentOutput, slog.LevelInfo)

	cfg, configErr := config.Load(config.OSLookup, bootstrap.Warn)
	if configErr != nil {
		fmt.Fprintf(os.Stderr, "registry-agent: %v\n", configErr)
		return 1
	}

	logger := newLogger(agentOutput, cfg.LogLevel)
	slog.SetDefault(logger)

	mkdirErr := os.MkdirAll(cfg.DataDir, dataDirPerm)
	if mkdirErr != nil {
		logger.Error("could not create the data directory", "path", cfg.DataDir, "error", mkdirErr)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	app, buildErr := build(ctx, cfg, logger, agentRing)
	if buildErr != nil {
		logger.Error("could not start", "error", buildErr)
		return 1
	}
	defer app.close()

	logger.Info("registry agent starting",
		"version", version,
		"listen", cfg.Listen,
		"apiListen", cfg.APIListen,
		"storageRoot", cfg.StorageRoot,
		"auth", string(cfg.Auth),
		"trustedProxies", len(cfg.TrustedProxies),
		"trivy", cfg.TrivyEnabled,
		"extraCommand", cfg.ExtraCommand != "")

	return app.serve(ctx, stop)
}

// application holds everything built at startup, with the goroutines that own
// each moving part.
type application struct {
	cfg      config.Config
	logger   *slog.Logger
	events   *events.Log
	scanner  *scan.Scanner
	gc       *gcjob.Runner
	registry *supervisor.Process
	extra    *supervisor.Process
	proxySrv *http.Server
	apiSrv   *http.Server
}

func build(ctx context.Context, cfg config.Config, logger *slog.Logger, agentRing *logbuf.Ring) (*application, error) {
	writeGate, gateErr := gate.New(cfg.DataDir)
	if gateErr != nil {
		return nil, gateErr
	}

	eventLog, eventErr := events.Open(cfg.DataDir, cfg.EventRetentionDays)
	if eventErr != nil {
		return nil, eventErr
	}

	userStore, usersErr := users.New(cfg.DataDir, cfg.ServiceUser)
	if usersErr != nil {
		return nil, usersErr
	}
	importUsers(cfg, userStore, logger)

	storageStore := storage.New(cfg.StorageRoot)
	registryBinary := resolveRegistryBinary()
	registryEnv := registryEnviron(cfg)

	gcRunner, gcErr := gcjob.New(gcjob.Options{
		Binary:     registryBinary,
		ConfigPath: cfg.RegistryConfig,
		DataDir:    cfg.DataDir,
		Env:        registryEnv,
		Store:      storageStore,
		Gate:       writeGate,
		Logger:     logger,
		BaseCtx:    context.WithoutCancel(ctx),
	})
	if gcErr != nil {
		return nil, gcErr
	}

	var scanner *scan.Scanner
	if cfg.TrivyEnabled {
		built, scanErr := scan.New(scan.Options{
			Binary:       cfg.TrivyPath,
			DataDir:      cfg.DataDir,
			InternalAddr: cfg.InternalAddr,
			Logger:       logger,
		})
		if scanErr != nil {
			return nil, scanErr
		}
		scanner = built
	}

	registryRing := logbuf.NewRing()
	registryProcess, registryErr := buildRegistryProcess(cfg, registryBinary, registryEnv, registryRing, logger)
	if registryErr != nil {
		return nil, registryErr
	}

	extraRing := logbuf.NewRing()
	var extraProcess *supervisor.Process
	if cfg.ExtraCommand != "" {
		argv := supervisor.ShellCommand(cfg.ExtraCommand)
		output := logbuf.NewWriter(extraRing, os.Stdout)
		built, extraErr := supervisor.New("extra", argv, supervisor.Environ(nil, nil), output, logger)
		if extraErr != nil {
			return nil, extraErr
		}
		extraProcess = built
	}

	target, targetErr := url.Parse("http://" + cfg.InternalAddr)
	if targetErr != nil {
		return nil, fmt.Errorf("parse internal registry address: %w", targetErr)
	}

	authenticator := proxy.NewAuthenticator(cfg.Auth, cfg.ServiceUser, cfg.APIKey, userStore)
	proxyHandler, proxyErr := proxy.New(proxy.Options{
		Target:         target,
		Authenticator:  authenticator,
		Gate:           writeGate,
		Events:         eventLog,
		RetryAfter:     cfg.GCRetryAfter,
		Logger:         logger,
		TrustedProxies: cfg.TrustedProxies,
	})
	if proxyErr != nil {
		return nil, proxyErr
	}

	rings := map[string]*logbuf.Ring{
		api.SourceRegistry: registryRing,
		api.SourceAgent:    agentRing,
	}
	if extraProcess != nil {
		rings[api.SourceExtra] = extraRing
	}

	apiHandler, apiErr := api.New(api.Deps{
		Version:  version,
		Config:   cfg,
		Storage:  storageStore,
		Gate:     writeGate,
		Users:    userStore,
		Events:   eventLog,
		GC:       gcRunner,
		Scanner:  scanner,
		Registry: registryProcess,
		Extra:    extraProcess,
		Logs:     rings,
		Logger:   logger,
	})
	if apiErr != nil {
		return nil, apiErr
	}

	app := &application{
		cfg:      cfg,
		logger:   logger,
		events:   eventLog,
		scanner:  scanner,
		gc:       gcRunner,
		registry: registryProcess,
		extra:    extraProcess,
		proxySrv: &http.Server{
			Addr:              cfg.Listen,
			Handler:           proxyHandler,
			ReadHeaderTimeout: readHeaderTimeout,
			IdleTimeout:       idleTimeout,
			ErrorLog:          nil,
		},
		apiSrv: &http.Server{
			Addr:              cfg.APIListen,
			Handler:           apiHandler,
			ReadHeaderTimeout: readHeaderTimeout,
			IdleTimeout:       idleTimeout,
		},
	}
	return app, nil
}

// serve runs every owned goroutine and returns the process exit code.
func (a *application) serve(ctx context.Context, stop context.CancelFunc) int {
	var workers sync.WaitGroup
	failures := make(chan error, 2)

	workers.Add(1)
	go func() {
		defer workers.Done()
		a.registry.Run(ctx)
	}()

	if a.extra != nil {
		workers.Add(1)
		go func() {
			defer workers.Done()
			a.extra.Run(ctx)
		}()
	}

	if a.scanner != nil {
		workers.Add(1)
		go func() {
			defer workers.Done()
			a.scanner.Run(ctx)
		}()
	}

	workers.Add(1)
	go func() {
		defer workers.Done()
		a.pruneEvents(ctx)
	}()

	workers.Add(1)
	go func() {
		defer workers.Done()
		a.logger.Info("public registry endpoint listening", "addr", a.cfg.Listen)
		listenErr := a.proxySrv.ListenAndServe()
		if listenErr != nil && !errors.Is(listenErr, http.ErrServerClosed) {
			failures <- fmt.Errorf("registry endpoint: %w", listenErr)
		}
	}()

	workers.Add(1)
	go func() {
		defer workers.Done()
		a.logger.Info("management API listening", "addr", a.cfg.APIListen)
		listenErr := a.apiSrv.ListenAndServe()
		if listenErr != nil && !errors.Is(listenErr, http.ErrServerClosed) {
			failures <- fmt.Errorf("management API: %w", listenErr)
		}
	}()

	code := 0
	select {
	case <-ctx.Done():
		a.logger.Info("shutting down")
	case failure := <-failures:
		a.logger.Error("a listener stopped", "error", failure)
		code = 1
		stop()
	}

	a.shutdownServers()
	a.gc.Wait()
	workers.Wait()
	return code
}

func (a *application) shutdownServers() {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	proxyErr := a.proxySrv.Shutdown(shutdownCtx)
	if proxyErr != nil {
		a.logger.Warn("registry endpoint did not stop cleanly", "error", proxyErr)
	}
	apiErr := a.apiSrv.Shutdown(shutdownCtx)
	if apiErr != nil {
		a.logger.Warn("management API did not stop cleanly", "error", apiErr)
	}
}

func (a *application) pruneEvents(ctx context.Context) {
	ticker := time.NewTicker(eventPruneInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pruneErr := a.events.Prune()
			if pruneErr != nil {
				a.logger.Warn("could not prune the event log", "error", pruneErr)
			}
		}
	}
}

func (a *application) close() {
	closeErr := a.events.Close()
	if closeErr != nil {
		a.logger.Warn("could not close the event log", "error", closeErr)
	}
}

// buildRegistryProcess wires the child registry: it listens on loopback only
// and always runs with deletes enabled, because every management operation
// depends on them.
func buildRegistryProcess(cfg config.Config, binary string, env []string, ring *logbuf.Ring, logger *slog.Logger) (*supervisor.Process, error) {
	argv := make([]string, 3)
	argv[0] = binary
	argv[1] = "serve"
	argv[2] = cfg.RegistryConfig

	output := logbuf.NewWriter(ring, os.Stdout)
	return supervisor.New("registry", argv, env, output, logger)
}

// registryEnviron is the environment every invocation of the registry binary
// gets — the supervised server and the garbage collector alike.
//
// Distribution reads REGISTRY_<SECTION>_… as configuration overrides, so the
// agent's own variables have to go: REGISTRY_STORAGE_ROOT would be read as a
// storage driver named "root" and stop it parsing its configuration at all.
// The two overrides are the contract's: loopback only, deletes enabled.
func registryEnviron(cfg config.Config) []string {
	overrides := map[string]string{
		"REGISTRY_HTTP_ADDR":              cfg.InternalAddr,
		"REGISTRY_STORAGE_DELETE_ENABLED": "true",
	}
	return supervisor.Environ(overrides, registryOnlyEnv)
}

// importUsers brings an existing htpasswd file's logins into the store once.
func importUsers(cfg config.Config, store *users.Store, logger *slog.Logger) {
	if cfg.Auth != config.AuthHtpasswd || cfg.HtpasswdImport == "" {
		return
	}
	imported, skipped, importErr := store.ImportHtpasswd(cfg.HtpasswdImport)
	if importErr != nil {
		logger.Warn("could not import htpasswd users", "path", cfg.HtpasswdImport, "error", importErr)
		return
	}
	logger.Info("imported htpasswd users",
		"path", cfg.HtpasswdImport,
		"imported", imported,
		"skipped", len(skipped))
}

func resolveRegistryBinary() string {
	configured := os.Getenv("REGISTRY_BINARY")
	if configured != "" {
		return configured
	}
	found, lookErr := exec.LookPath(defaultRegistryBinary)
	if lookErr != nil {
		return defaultRegistryBinary
	}
	return found
}

func newLogger(output io.Writer, level slog.Level) *slog.Logger {
	handler := slog.NewTextHandler(output, &slog.HandlerOptions{Level: level})
	return slog.New(handler)
}
