package api

import (
	"errors"
	"net/http"

	"github.com/navid-kianfar/registry-vault/agent/internal/config"
	"github.com/navid-kianfar/registry-vault/agent/internal/users"
)

type usersResponse struct {
	Users []users.User `json:"users"`
}

// userResponse carries a generated password exactly once: it is never stored
// in clear and cannot be read back.
type userResponse struct {
	User     users.User `json:"user"`
	Password string     `json:"password,omitempty"`
}

type createUserRequest struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	Password string `json:"password"`
}

type updateUserRequest struct {
	Role          *string `json:"role"`
	Password      *string `json:"password"`
	ResetPassword bool    `json:"resetPassword"`
}

// usersAvailable guards every user route: with REGISTRY_AUTH=none there is no
// user store to manage.
func (s *server) usersAvailable(w http.ResponseWriter) bool {
	if s.deps.Config.Auth == config.AuthHtpasswd && s.deps.Users != nil {
		return true
	}
	writeError(w, http.StatusServiceUnavailable, codeUnavailable,
		"user management needs REGISTRY_AUTH=htpasswd")
	return false
}

func (s *server) handleListUsers(w http.ResponseWriter, _ *http.Request) {
	if !s.usersAvailable(w) {
		return
	}
	writeJSON(w, http.StatusOK, usersResponse{Users: s.deps.Users.List()})
}

func (s *server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if !s.usersAvailable(w) {
		return
	}

	var body createUserRequest
	decodeErr := decodeBody(r, &body)
	if decodeErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the request body is not valid JSON")
		return
	}
	role, roleErr := users.ParseRole(body.Role)
	if roleErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "role must be pull, push or admin")
		return
	}

	created, generated, createErr := s.deps.Users.Create(body.Username, role, body.Password)
	if createErr != nil {
		s.writeUserError(w, createErr)
		return
	}
	s.deps.Logger.Info("registry user created", "username", created.Username, "role", created.Role)
	writeJSON(w, http.StatusCreated, userResponse{User: created, Password: generated})
}

func (s *server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	if !s.usersAvailable(w) {
		return
	}

	var body updateUserRequest
	decodeErr := decodeBody(r, &body)
	if decodeErr != nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "the request body is not valid JSON")
		return
	}

	changes := users.Changes{ResetPassword: body.ResetPassword}
	if body.Role != nil {
		role, roleErr := users.ParseRole(*body.Role)
		if roleErr != nil {
			writeError(w, http.StatusBadRequest, codeBadRequest, "role must be pull, push or admin")
			return
		}
		changes.Role = &role
	}
	changes.Password = body.Password

	username := r.PathValue("username")
	updated, generated, updateErr := s.deps.Users.Update(username, changes)
	if updateErr != nil {
		s.writeUserError(w, updateErr)
		return
	}
	s.deps.Logger.Info("registry user updated", "username", updated.Username, "role", updated.Role)
	writeJSON(w, http.StatusOK, userResponse{User: updated, Password: generated})
}

func (s *server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	if !s.usersAvailable(w) {
		return
	}

	username := r.PathValue("username")
	deleteErr := s.deps.Users.Delete(username)
	if deleteErr != nil {
		s.writeUserError(w, deleteErr)
		return
	}
	s.deps.Logger.Info("registry user deleted", "username", username)
	w.WriteHeader(http.StatusNoContent)
}

// writeUserError maps the store's sentinels onto the contract's codes.
func (s *server) writeUserError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, users.ErrNotFound):
		writeError(w, http.StatusNotFound, codeNotFound, "no such user")
	case errors.Is(err, users.ErrExists):
		writeError(w, http.StatusConflict, codeConflict, "that user already exists")
	case errors.Is(err, users.ErrInvalidUsername):
		writeError(w, http.StatusBadRequest, codeBadRequest,
			"the username must be lowercase, 2 to 64 characters, and start with a letter or digit")
	case errors.Is(err, users.ErrReservedUsername):
		writeError(w, http.StatusConflict, codeConflict, "that username is reserved for the service principal")
	case errors.Is(err, users.ErrInvalidRole):
		writeError(w, http.StatusBadRequest, codeBadRequest, "role must be pull, push or admin")
	case errors.Is(err, users.ErrPasswordTooShort):
		writeError(w, http.StatusBadRequest, codeBadRequest, err.Error())
	case errors.Is(err, users.ErrBadChange):
		writeError(w, http.StatusBadRequest, codeBadRequest, err.Error())
	default:
		s.deps.Logger.Error("user store failed", "error", err)
		writeError(w, http.StatusInternalServerError, codeInternal, "could not change the user store")
	}
}
