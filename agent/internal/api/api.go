// Package api is the management API on :5080 — everything the Registry HTTP
// API cannot do. Every route but /healthz needs the agent's bearer key.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/navid-kianfar/registry-vault/agent/internal/config"
	"github.com/navid-kianfar/registry-vault/agent/internal/events"
	"github.com/navid-kianfar/registry-vault/agent/internal/gate"
	"github.com/navid-kianfar/registry-vault/agent/internal/gcjob"
	"github.com/navid-kianfar/registry-vault/agent/internal/logbuf"
	"github.com/navid-kianfar/registry-vault/agent/internal/scan"
	"github.com/navid-kianfar/registry-vault/agent/internal/storage"
	"github.com/navid-kianfar/registry-vault/agent/internal/supervisor"
	"github.com/navid-kianfar/registry-vault/agent/internal/users"
)

// Error codes, as the contract lists them.
const (
	codeUnauthorized = "unauthorized"
	codeNotFound     = "not_found"
	codeConflict     = "conflict"
	codeUnavailable  = "unavailable"
	codeBadRequest   = "bad_request"
	codeInternal     = "internal"
)

// maxRequestBody caps a management request body. Every one of them is a small
// JSON object.
const maxRequestBody = 1 << 20

// logbufCapacity is the most log lines one request can ask for.
const logbufCapacity = logbuf.Capacity

// LogSources are the log sources the API serves.
const (
	SourceRegistry = "registry"
	SourceAgent    = "agent"
	SourceExtra    = "extra"
)

// Deps is everything the API reads and drives. The API owns none of it.
type Deps struct {
	Version  string
	Config   config.Config
	Storage  *storage.Store
	Gate     *gate.Gate
	Users    *users.Store
	Events   *events.Log
	GC       *gcjob.Runner
	Scanner  *scan.Scanner
	Registry *supervisor.Process
	Extra    *supervisor.Process
	Logs     map[string]*logbuf.Ring
	Logger   *slog.Logger
}

type server struct {
	deps Deps
}

// New builds the management API handler.
func New(deps Deps) (http.Handler, error) {
	if deps.Storage == nil || deps.Gate == nil || deps.GC == nil {
		return nil, errors.New("api: storage, gate and gc are required")
	}
	if deps.Logger == nil {
		deps.Logger = slog.Default()
	}

	s := &server{deps: deps}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealthz)

	mux.Handle("GET /api/v1/info", s.authenticated(s.handleInfo))
	mux.Handle("GET /api/v1/health", s.authenticated(s.handleHealth))
	mux.Handle("POST /api/v1/registry/restart", s.authenticated(s.handleRestart))
	mux.Handle("GET /api/v1/logs", s.authenticated(s.handleLogs))

	mux.Handle("GET /api/v1/storage", s.authenticated(s.handleStorage))

	mux.Handle("POST /api/v1/gc", s.authenticated(s.handleStartGC))
	mux.Handle("GET /api/v1/gc", s.authenticated(s.handleCurrentGC))
	mux.Handle("GET /api/v1/gc/history", s.authenticated(s.handleGCHistory))

	mux.Handle("DELETE /api/v1/repositories/{name...}", s.authenticated(s.handleRemoveRepository))

	mux.Handle("GET /api/v1/uploads", s.authenticated(s.handleListUploads))
	mux.Handle("POST /api/v1/uploads/purge", s.authenticated(s.handlePurgeUploads))

	mux.Handle("GET /api/v1/maintenance", s.authenticated(s.handleGetMaintenance))
	mux.Handle("PUT /api/v1/maintenance", s.authenticated(s.handleSetMaintenance))

	mux.Handle("GET /api/v1/users", s.authenticated(s.handleListUsers))
	mux.Handle("POST /api/v1/users", s.authenticated(s.handleCreateUser))
	mux.Handle("PATCH /api/v1/users/{username}", s.authenticated(s.handleUpdateUser))
	mux.Handle("DELETE /api/v1/users/{username}", s.authenticated(s.handleDeleteUser))

	mux.Handle("GET /api/v1/events", s.authenticated(s.handleEvents))

	mux.Handle("POST /api/v1/scans", s.authenticated(s.handleCreateScan))
	mux.Handle("GET /api/v1/scans", s.authenticated(s.handleListScans))
	mux.Handle("GET /api/v1/scans/{id}", s.authenticated(s.handleGetScan))

	return s.recoverPanics(mux), nil
}

// authenticated wraps a handler with the bearer-key check.
func (s *server) authenticated(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authorized(r) {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "a valid bearer key is required")
			return
		}
		next(w, r)
	})
}

func (s *server) authorized(r *http.Request) bool {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return false
	}
	presented := header[len(prefix):]
	match := subtle.ConstantTimeCompare([]byte(presented), []byte(s.deps.Config.APIKey))
	return match == 1
}

// recoverPanics keeps one broken handler from taking the agent down, and keeps
// the panic out of the response.
func (s *server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			s.deps.Logger.Error("management API panicked",
				"method", r.Method, "path", r.URL.Path, "panic", recovered)
			writeError(w, http.StatusInternalServerError, codeInternal, "internal error")
		}()
		next.ServeHTTP(w, r)
	})
}

// apiError is the error body every failing route returns.
type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, apiError{Error: code, Message: message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	payload, marshalErr := json.Marshal(value)
	if marshalErr != nil {
		http.Error(w, `{"error":"internal","message":"could not encode response"}`, http.StatusInternalServerError)
		return
	}
	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Content-Length", strconv.Itoa(len(payload)))
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

// decodeBody reads a JSON request body. An empty body is not an error: every
// route that uses it has defaults.
func decodeBody(r *http.Request, value any) error {
	limited := io.LimitReader(r.Body, maxRequestBody)
	raw, readErr := io.ReadAll(limited)
	if readErr != nil {
		return fmt.Errorf("read body: %w", readErr)
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil
	}
	unmarshalErr := json.Unmarshal(raw, value)
	if unmarshalErr != nil {
		return fmt.Errorf("parse body: %w", unmarshalErr)
	}
	return nil
}

// intQuery reads a bounded integer query parameter.
func intQuery(r *http.Request, name string, fallback, minimum, maximum int) (int, error) {
	raw := r.URL.Query().Get(name)
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, convErr := strconv.Atoi(raw)
	if convErr != nil {
		return 0, fmt.Errorf("%s must be a number", name)
	}
	if value < minimum {
		return 0, fmt.Errorf("%s must be at least %d", name, minimum)
	}
	if value > maximum {
		value = maximum
	}
	return value, nil
}

func boolQuery(r *http.Request, name string) bool {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return false
	}
	value, convErr := strconv.ParseBool(raw)
	if convErr != nil {
		return false
	}
	return value
}
