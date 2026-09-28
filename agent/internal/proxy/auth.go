package proxy

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/navid-kianfar/registry-vault/agent/internal/config"
	"github.com/navid-kianfar/registry-vault/agent/internal/users"
)

// AnonymousActor is the actor recorded when REGISTRY_AUTH is none.
const AnonymousActor = "anonymous"

// catalogPath is the only route restricted to admins by path rather than by
// method.
const catalogPath = "/v2/_catalog"

// Identity is who made a request and what they may do.
type Identity struct {
	Actor string
	Role  users.Role
}

// Authenticator resolves Basic credentials to an identity.
type Authenticator struct {
	mode        config.AuthMode
	serviceUser string
	apiKey      string
	store       *users.Store
}

// NewAuthenticator builds the authenticator for one auth mode. store may be nil
// when the mode is none.
func NewAuthenticator(mode config.AuthMode, serviceUser, apiKey string, store *users.Store) *Authenticator {
	return &Authenticator{
		mode:        mode,
		serviceUser: serviceUser,
		apiKey:      apiKey,
		store:       store,
	}
}

// Authenticate resolves the request's identity. ok is false when credentials
// are missing or wrong.
func (a *Authenticator) Authenticate(r *http.Request) (Identity, bool) {
	username, password, hasBasic := r.BasicAuth()

	if hasBasic && a.isServicePrincipal(username, password) {
		return Identity{Actor: a.serviceUser, Role: users.RoleAdmin}, true
	}

	switch a.mode {
	case config.AuthNone:
		// No authentication at all: anonymous clients may pull and push. The
		// service principal above is still recognised, so Registry Vault keeps
		// its admin rights and its own traffic stays attributable.
		return Identity{Actor: AnonymousActor, Role: users.RolePush}, true
	case config.AuthHtpasswd:
		if !hasBasic || a.store == nil {
			return Identity{}, false
		}
		role, verified := a.store.Verify(username, password)
		if !verified {
			return Identity{}, false
		}
		return Identity{Actor: username, Role: role}, true
	default:
		return Identity{}, false
	}
}

// RequiresCredentials reports whether a 401 should carry a Basic challenge.
// In anonymous mode it must not, or Docker prompts for a login that does not
// exist.
func (a *Authenticator) RequiresCredentials() bool {
	return a.mode == config.AuthHtpasswd
}

// isServicePrincipal compares both halves in constant time, so neither the
// service username nor the API key leaks through response timing.
func (a *Authenticator) isServicePrincipal(username, password string) bool {
	if a.apiKey == "" {
		return false
	}
	nameMatch := subtle.ConstantTimeCompare([]byte(username), []byte(a.serviceUser))
	keyMatch := subtle.ConstantTimeCompare([]byte(password), []byte(a.apiKey))
	return nameMatch == 1 && keyMatch == 1
}

// actionFor classifies a request into what a role must allow.
func actionFor(r *http.Request) users.Action {
	if isCatalogRequest(r) {
		return users.ActionCatalog
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return users.ActionRead
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return users.ActionWrite
	case http.MethodDelete:
		return users.ActionDelete
	default:
		// An unknown method is treated as a write: the safe side of the gate.
		return users.ActionWrite
	}
}

func isCatalogRequest(r *http.Request) bool {
	path := r.URL.Path
	if path == catalogPath {
		return true
	}
	return strings.HasPrefix(path, catalogPath+"/")
}

// isMutating reports whether the request must pass the write gate.
func isMutating(action users.Action) bool {
	switch action {
	case users.ActionWrite, users.ActionDelete:
		return true
	case users.ActionRead, users.ActionCatalog:
		return false
	default:
		return true
	}
}
