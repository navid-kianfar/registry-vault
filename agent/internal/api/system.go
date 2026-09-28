package api

import (
	"net/http"

	"github.com/navid-kianfar/registry-vault/agent/internal/gate"
	"github.com/navid-kianfar/registry-vault/agent/internal/storage"
	"github.com/navid-kianfar/registry-vault/agent/internal/supervisor"
)

const (
	// defaultLogLines is how many lines GET /api/v1/logs returns by default.
	defaultLogLines = 200
	// unknownVersion is reported when the registry binary cannot be asked.
	unknownVersion = "unknown"
)

type healthzResponse struct {
	Status string `json:"status"`
}

func (s *server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthzResponse{Status: "ok"})
}

type infoResponse struct {
	Version         string   `json:"version"`
	RegistryVersion string   `json:"registryVersion"`
	Features        []string `json:"features"`
	Auth            string   `json:"auth"`
	StorageRoot     string   `json:"storageRoot"`
}

func (s *server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	registryVersion, versionErr := s.deps.GC.RegistryVersion()
	if versionErr != nil {
		s.deps.Logger.Warn("could not read the registry version", "error", versionErr)
		registryVersion = unknownVersion
	}

	response := infoResponse{
		Version:         s.deps.Version,
		RegistryVersion: registryVersion,
		Features:        s.deps.Config.Features(),
		Auth:            string(s.deps.Config.Auth),
		StorageRoot:     s.deps.Storage.Root(),
	}
	writeJSON(w, http.StatusOK, response)
}

type gcState struct {
	State string `json:"state"`
}

type healthResponse struct {
	Registry    supervisor.Status  `json:"registry"`
	Extra       *supervisor.Status `json:"extra"`
	Maintenance gate.Maintenance   `json:"maintenance"`
	GC          gcState            `json:"gc"`
	Disk        storage.Disk       `json:"disk"`
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	response := healthResponse{
		Maintenance: s.deps.Gate.Maintenance(),
		GC:          gcState{State: s.deps.GC.State()},
	}
	if s.deps.Registry != nil {
		response.Registry = s.deps.Registry.Status()
	}
	if s.deps.Extra != nil {
		extra := s.deps.Extra.Status()
		response.Extra = &extra
	}

	disk, diskErr := s.deps.Storage.DiskUsage()
	if diskErr != nil {
		s.deps.Logger.Warn("could not read disk usage", "error", diskErr)
	}
	response.Disk = disk
	writeJSON(w, http.StatusOK, response)
}

type restartResponse struct {
	Restarting bool `json:"restarting"`
}

func (s *server) handleRestart(w http.ResponseWriter, _ *http.Request) {
	if s.deps.GC.Running() {
		writeError(w, http.StatusConflict, codeConflict,
			"the registry cannot be restarted while a garbage collection is running")
		return
	}
	if s.deps.Registry == nil {
		writeError(w, http.StatusServiceUnavailable, codeUnavailable, "no registry process is supervised")
		return
	}
	s.deps.Registry.Restart()
	writeJSON(w, http.StatusAccepted, restartResponse{Restarting: true})
}

type logsResponse struct {
	Source string   `json:"source"`
	Lines  []string `json:"lines"`
}

func (s *server) handleLogs(w http.ResponseWriter, r *http.Request) {
	source := r.URL.Query().Get("source")
	if source == "" {
		source = SourceRegistry
	}
	switch source {
	case SourceRegistry, SourceAgent, SourceExtra:
	default:
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"source must be one of registry, agent or extra")
		return
	}

	lines, queryErr := intQuery(r, "lines", defaultLogLines, 1, logbufCapacity)
	if queryErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, queryErr.Error())
		return
	}

	ring, known := s.deps.Logs[source]
	if !known || ring == nil {
		writeError(w, http.StatusNotFound, codeNotFound, "no log for source "+source)
		return
	}
	writeJSON(w, http.StatusOK, logsResponse{Source: source, Lines: ring.Last(lines)})
}

func (s *server) handleGetMaintenance(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.deps.Gate.Maintenance())
}

type maintenanceRequest struct {
	ReadOnly *bool  `json:"readOnly"`
	Reason   string `json:"reason"`
}

func (s *server) handleSetMaintenance(w http.ResponseWriter, r *http.Request) {
	var body maintenanceRequest
	decodeErr := decodeBody(r, &body)
	if decodeErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the request body is not valid JSON")
		return
	}
	if body.ReadOnly == nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "readOnly is required")
		return
	}

	state, setErr := s.deps.Gate.SetMaintenance(*body.ReadOnly, body.Reason)
	if setErr != nil {
		s.deps.Logger.Error("could not persist maintenance state", "error", setErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not store the maintenance state")
		return
	}
	s.deps.Logger.Info("maintenance state changed", "readOnly", state.ReadOnly)
	writeJSON(w, http.StatusOK, state)
}
