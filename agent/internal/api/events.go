package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/navid-kianfar/registry-vault/agent/internal/events"
)

func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if s.deps.Events == nil {
		writeError(w, http.StatusServiceUnavailable, codeUnavailable, "the event log is not available")
		return
	}

	after, afterErr := seqQuery(r, "after")
	if afterErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, afterErr.Error())
		return
	}
	limit, limitErr := intQuery(r, "limit", events.DefaultLimit, 1, events.MaxLimit)
	if limitErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, limitErr.Error())
		return
	}

	page := s.deps.Events.Query(after, limit)
	writeJSON(w, http.StatusOK, page)
}

func seqQuery(r *http.Request, name string) (uint64, error) {
	raw := r.URL.Query().Get(name)
	if strings.TrimSpace(raw) == "" {
		return 0, nil
	}
	value, convErr := strconv.ParseUint(raw, 10, 64)
	if convErr != nil {
		return 0, newBadQuery(name)
	}
	return value, nil
}

type badQueryError struct {
	name string
}

func (e badQueryError) Error() string {
	return e.name + " must be a non-negative number"
}

func newBadQuery(name string) error {
	return badQueryError{name: name}
}
