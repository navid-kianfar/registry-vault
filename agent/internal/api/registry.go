package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/navid-kianfar/registry-vault/agent/internal/gcjob"
	"github.com/navid-kianfar/registry-vault/agent/internal/storage"
)

const (
	// defaultUploadAgeHours is the age threshold for listing and purging.
	defaultUploadAgeHours = 24
	// maxUploadAgeHours is a year; beyond that the filter is meaningless.
	maxUploadAgeHours = 24 * 365
	// removalReason is what a blocked client is told while a repository is
	// being removed.
	removalReason = "repository removal"
	// removalDrainTimeout is how long removal waits for in-flight writes.
	removalDrainTimeout = 60 * time.Second
)

func (s *server) handleStorage(w http.ResponseWriter, r *http.Request) {
	refresh := boolQuery(r, "refresh")
	report, reportErr := s.deps.Storage.Report(refresh)
	if reportErr != nil {
		s.deps.Logger.Error("could not compute storage report", "error", reportErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not read the storage tree")
		return
	}
	writeJSON(w, http.StatusOK, report)
}

type gcRequest struct {
	DryRun bool `json:"dryRun"`
}

func (s *server) handleStartGC(w http.ResponseWriter, r *http.Request) {
	var body gcRequest
	decodeErr := decodeBody(r, &body)
	if decodeErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the request body is not valid JSON")
		return
	}

	job, startErr := s.deps.GC.Start(body.DryRun)
	if startErr == nil {
		s.deps.Logger.Info("garbage collection started", "job", job.ID, "dryRun", job.DryRun)
		writeJSON(w, http.StatusAccepted, job)
		return
	}

	switch {
	case errors.Is(startErr, gcjob.ErrAlreadyRunning):
		writeError(w, http.StatusConflict, codeConflict, startErr.Error())
	case errors.Is(startErr, gcjob.ErrUnsupported):
		writeError(w, http.StatusConflict, codeConflict, startErr.Error())
	default:
		s.deps.Logger.Error("could not start garbage collection", "error", startErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not start garbage collection")
	}
}

func (s *server) handleCurrentGC(w http.ResponseWriter, _ *http.Request) {
	job, err := s.deps.GC.Current()
	if errors.Is(err, gcjob.ErrNoJob) {
		writeError(w, http.StatusNotFound, codeNotFound, "no garbage collection has run yet")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, codeInternal, "could not read the garbage collection job")
		return
	}
	writeJSON(w, http.StatusOK, job)
}

type gcHistoryResponse struct {
	Jobs []gcjob.Job `json:"jobs"`
}

func (s *server) handleGCHistory(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, gcHistoryResponse{Jobs: s.deps.GC.History()})
}

type removedResponse struct {
	Removed string `json:"removed"`
}

func (s *server) handleRemoveRepository(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	nameErr := storage.ValidateName(name)
	if nameErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the repository name is not valid")
		return
	}

	// Removal takes the same gate as a garbage collection, so a push cannot
	// land in a directory that is being deleted.
	release, drained := s.deps.Gate.Hold(removalReason, removalDrainTimeout)
	defer release()
	if !drained {
		s.deps.Logger.Warn("removing a repository with writes still in flight", "repository", name)
	}

	force := boolQuery(r, "force")
	removeErr := s.deps.Storage.RemoveRepository(name, force)
	switch {
	case removeErr == nil:
		s.deps.Logger.Info("repository removed", "repository", name, "force", force)
		writeJSON(w, http.StatusOK, removedResponse{Removed: name})
	case errors.Is(removeErr, storage.ErrRepositoryNotFound):
		writeError(w, http.StatusNotFound, codeNotFound, "no such repository")
	case errors.Is(removeErr, storage.ErrRepositoryHasTags):
		writeError(w, http.StatusConflict, codeConflict,
			"the repository still has tags; delete them first or pass force=true")
	case errors.Is(removeErr, storage.ErrInvalidName):
		writeError(w, http.StatusBadRequest, codeBadRequest, "the repository name is not valid")
	default:
		s.deps.Logger.Error("could not remove repository", "repository", name, "error", removeErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not remove the repository")
	}
}

func (s *server) handleListUploads(w http.ResponseWriter, r *http.Request) {
	hours, queryErr := intQuery(r, "olderThanHours", defaultUploadAgeHours, 0, maxUploadAgeHours)
	if queryErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, queryErr.Error())
		return
	}

	age := time.Duration(hours) * time.Hour
	list, listErr := s.deps.Storage.Uploads(age)
	if listErr != nil {
		s.deps.Logger.Error("could not list uploads", "error", listErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not read the uploads")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type purgeRequest struct {
	OlderThanHours *int `json:"olderThanHours"`
}

func (s *server) handlePurgeUploads(w http.ResponseWriter, r *http.Request) {
	var body purgeRequest
	decodeErr := decodeBody(r, &body)
	if decodeErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the request body is not valid JSON")
		return
	}

	hours := defaultUploadAgeHours
	if body.OlderThanHours != nil {
		hours = *body.OlderThanHours
	}
	// An upload younger than an hour may be a push in progress; the minimum is
	// what keeps a purge from breaking one.
	if hours < 1 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "olderThanHours must be at least 1")
		return
	}
	if hours > maxUploadAgeHours {
		hours = maxUploadAgeHours
	}

	age := time.Duration(hours) * time.Hour
	result, purgeErr := s.deps.Storage.PurgeUploads(age)
	if purgeErr != nil {
		s.deps.Logger.Error("could not purge uploads", "error", purgeErr)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not purge the uploads")
		return
	}
	s.deps.Logger.Info("uploads purged", "purged", result.Purged, "freedBytes", result.FreedBytes)
	writeJSON(w, http.StatusOK, result)
}
