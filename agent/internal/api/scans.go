package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/navid-kianfar/registry-vault/agent/internal/scan"
	"github.com/navid-kianfar/registry-vault/agent/internal/storage"
)

type scanRequest struct {
	Repository string `json:"repository"`
	Reference  string `json:"reference"`
	Platform   string `json:"platform"`
}

type scanResponse struct {
	Scan scan.Scan `json:"scan"`
}

type scanListResponse struct {
	Scans []scan.Brief `json:"scans"`
}

// scanningAvailable guards every scan route.
func (s *server) scanningAvailable(w http.ResponseWriter) bool {
	if s.deps.Config.TrivyEnabled && s.deps.Scanner != nil {
		return true
	}
	writeError(w, http.StatusServiceUnavailable, codeUnavailable,
		"scanning is disabled; set TRIVY_ENABLED and install trivy")
	return false
}

func (s *server) handleCreateScan(w http.ResponseWriter, r *http.Request) {
	if !s.scanningAvailable(w) {
		return
	}

	var body scanRequest
	decodeErr := decodeBody(r, &body)
	if decodeErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the request body is not valid JSON")
		return
	}

	nameErr := storage.ValidateName(body.Repository)
	if nameErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the repository name is not valid")
		return
	}
	reference := strings.TrimSpace(body.Reference)
	if reference == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "reference is required")
		return
	}

	request := scan.Request{
		Repository: body.Repository,
		Reference:  reference,
		Platform:   body.Platform,
	}
	queued, submitErr := s.deps.Scanner.Submit(request)
	if errors.Is(submitErr, scan.ErrQueueFull) {
		writeError(w, http.StatusConflict, codeConflict, "the scan queue is full; try again later")
		return
	}
	if submitErr != nil {
		s.deps.Logger.Error("could not queue scan", "error", submitErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not queue the scan")
		return
	}
	writeJSON(w, http.StatusAccepted, scanResponse{Scan: queued})
}

func (s *server) handleGetScan(w http.ResponseWriter, r *http.Request) {
	if !s.scanningAvailable(w) {
		return
	}

	id := r.PathValue("id")
	record, getErr := s.deps.Scanner.Get(id)
	if errors.Is(getErr, scan.ErrNotFound) {
		writeError(w, http.StatusNotFound, codeNotFound, "no such scan")
		return
	}
	if getErr != nil {
		s.deps.Logger.Error("could not read scan", "scan", id, "error", getErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not read the scan")
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *server) handleListScans(w http.ResponseWriter, r *http.Request) {
	if !s.scanningAvailable(w) {
		return
	}

	query := r.URL.Query()
	repository := query.Get("repository")
	reference := query.Get("reference")
	found := s.deps.Scanner.List(repository, reference)
	writeJSON(w, http.StatusOK, scanListResponse{Scans: found})
}
