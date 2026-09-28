package users

import "fmt"

// Role is what a registry user may do on the public endpoint.
type Role string

const (
	// RolePull may read: GET and HEAD under /v2/.
	RolePull Role = "pull"
	// RolePush may read and write: uploads and manifest puts.
	RolePush Role = "push"
	// RoleAdmin may read, write, delete and list the catalog.
	RoleAdmin Role = "admin"
)

// Action is one class of registry request, as the write gate and the role
// check see it.
type Action int

const (
	// ActionRead is GET or HEAD on anything but the catalog.
	ActionRead Action = iota
	// ActionWrite is POST, PUT or PATCH.
	ActionWrite
	// ActionDelete is DELETE.
	ActionDelete
	// ActionCatalog is GET /v2/_catalog.
	ActionCatalog
)

// ParseRole validates a role name coming from the API or a config file.
func ParseRole(raw string) (Role, error) {
	switch Role(raw) {
	case RolePull:
		return RolePull, nil
	case RolePush:
		return RolePush, nil
	case RoleAdmin:
		return RoleAdmin, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidRole, raw)
	}
}

// Allows reports whether this role may perform action.
func (r Role) Allows(action Action) bool {
	switch r {
	case RolePull:
		return action == ActionRead
	case RolePush:
		return action == ActionRead || action == ActionWrite
	case RoleAdmin:
		return true
	default:
		return false
	}
}
