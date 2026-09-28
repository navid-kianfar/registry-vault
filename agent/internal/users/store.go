// Package users is the agent's registry user store: bcrypt password hashes in
// a JSON file written atomically, a short-lived verification cache so a pull
// does not pay bcrypt per request, and import of an existing htpasswd file.
package users

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/navid-kianfar/registry-vault/agent/internal/atomicio"
)

const (
	// usersFile is the store's file inside the data directory.
	usersFile = "users.json"
	// bcryptCost is the cost factor for stored passwords.
	bcryptCost = 10
	// MinPasswordLen is the shortest password the API accepts.
	MinPasswordLen = 12
	// generatedPasswordLen is the length of a password the agent generates.
	generatedPasswordLen = 24
	// cacheTTL is how long a successful verification is trusted.
	cacheTTL = 60 * time.Second
	// storeVersion is the on-disk schema version.
	storeVersion = 1
)

// Store errors. Callers branch on these, so they are sentinels.
var (
	ErrNotFound         = errors.New("user not found")
	ErrExists           = errors.New("user already exists")
	ErrInvalidUsername  = errors.New("invalid username")
	ErrReservedUsername = errors.New("username is reserved")
	ErrInvalidRole      = errors.New("invalid role")
	ErrPasswordTooShort = fmt.Errorf("password must be at least %d characters", MinPasswordLen)
	ErrBadChange        = errors.New("password and resetPassword are mutually exclusive")
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,63}$`)

// passwordAlphabet leaves out characters that are easy to confuse when a
// generated password is copied by hand.
const passwordAlphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_"

// User is the public view of a stored user: never the hash.
type User struct {
	Username   string     `json:"username"`
	Role       Role       `json:"role"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	LastUsedAt *time.Time `json:"lastUsedAt"`
}

// record is the stored form, hash included.
type record struct {
	Username     string     `json:"username"`
	Role         Role       `json:"role"`
	PasswordHash string     `json:"passwordHash"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	LastUsedAt   *time.Time `json:"lastUsedAt"`
}

func (r record) public() User {
	return User{
		Username:   r.Username,
		Role:       r.Role,
		CreatedAt:  r.CreatedAt,
		UpdatedAt:  r.UpdatedAt,
		LastUsedAt: r.LastUsedAt,
	}
}

type storeFile struct {
	Version int      `json:"version"`
	Users   []record `json:"users"`
}

type cacheEntry struct {
	username  string
	role      Role
	expiresAt time.Time
}

// Store holds the users. It is safe for concurrent use.
type Store struct {
	path     string
	reserved string

	mu    sync.RWMutex
	users map[string]record
	cache map[string]cacheEntry

	now func() time.Time
}

// New loads the store from dataDir. reserved is the service principal's
// username, which no stored user may take.
func New(dataDir, reserved string) (*Store, error) {
	path := filepath.Join(dataDir, usersFile)
	s := &Store{
		path:     path,
		reserved: reserved,
		users:    make(map[string]record),
		cache:    make(map[string]cacheEntry),
		now:      func() time.Time { return time.Now().UTC() },
	}

	var file storeFile
	_, readErr := atomicio.ReadJSON(path, &file)
	if readErr != nil {
		return nil, fmt.Errorf("load user store: %w", readErr)
	}
	for _, stored := range file.Users {
		s.users[stored.Username] = stored
	}
	return s, nil
}

// List returns every user, ordered by username.
func (s *Store) List() []User {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]User, 0, len(s.users))
	for _, stored := range s.users {
		out = append(out, stored.public())
	}
	slices.SortFunc(out, func(a, b User) int {
		return strings.Compare(a.Username, b.Username)
	})
	return out
}

// Create adds a user. An empty password makes the agent generate one, which is
// returned once and never stored in clear.
func (s *Store) Create(username string, role Role, password string) (User, string, error) {
	nameErr := s.validateUsername(username)
	if nameErr != nil {
		return User{}, "", nameErr
	}

	generated := ""
	if password == "" {
		fresh, genErr := GeneratePassword()
		if genErr != nil {
			return User{}, "", genErr
		}
		generated = fresh
		password = fresh
	}
	if len(password) < MinPasswordLen {
		return User{}, "", ErrPasswordTooShort
	}

	hash, hashErr := hashPassword(password)
	if hashErr != nil {
		return User{}, "", hashErr
	}

	s.mu.Lock()
	_, exists := s.users[username]
	if exists {
		s.mu.Unlock()
		return User{}, "", ErrExists
	}
	now := s.now()
	stored := record{
		Username:     username,
		Role:         role,
		PasswordHash: hash,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	s.users[username] = stored
	clear(s.cache)
	snapshot := s.snapshotLocked()
	s.mu.Unlock()

	persistErr := s.persist(snapshot)
	if persistErr != nil {
		return User{}, "", persistErr
	}
	return stored.public(), generated, nil
}

// Changes describes a PATCH on a user. A nil field is left alone.
type Changes struct {
	Role          *Role
	Password      *string
	ResetPassword bool
}

// Update applies changes. When ResetPassword is set the agent generates a new
// password and returns it once.
func (s *Store) Update(username string, changes Changes) (User, string, error) {
	generated := ""
	newHash := ""

	if changes.ResetPassword && changes.Password != nil {
		return User{}, "", ErrBadChange
	}
	if changes.ResetPassword {
		fresh, genErr := GeneratePassword()
		if genErr != nil {
			return User{}, "", genErr
		}
		generated = fresh
		hash, hashErr := hashPassword(fresh)
		if hashErr != nil {
			return User{}, "", hashErr
		}
		newHash = hash
	}
	if changes.Password != nil {
		if len(*changes.Password) < MinPasswordLen {
			return User{}, "", ErrPasswordTooShort
		}
		hash, hashErr := hashPassword(*changes.Password)
		if hashErr != nil {
			return User{}, "", hashErr
		}
		newHash = hash
	}

	s.mu.Lock()
	stored, ok := s.users[username]
	if !ok {
		s.mu.Unlock()
		return User{}, "", ErrNotFound
	}
	if changes.Role != nil {
		stored.Role = *changes.Role
	}
	if newHash != "" {
		stored.PasswordHash = newHash
	}
	stored.UpdatedAt = s.now()
	s.users[username] = stored
	clear(s.cache)
	snapshot := s.snapshotLocked()
	s.mu.Unlock()

	persistErr := s.persist(snapshot)
	if persistErr != nil {
		return User{}, "", persistErr
	}
	return stored.public(), generated, nil
}

// Delete removes a user.
func (s *Store) Delete(username string) error {
	s.mu.Lock()
	_, ok := s.users[username]
	if !ok {
		s.mu.Unlock()
		return ErrNotFound
	}
	delete(s.users, username)
	clear(s.cache)
	snapshot := s.snapshotLocked()
	s.mu.Unlock()

	return s.persist(snapshot)
}

// Verify checks Basic credentials. A successful bcrypt verification is cached
// for cacheTTL keyed by a SHA-256 of the credentials, so a pull with hundreds
// of requests pays bcrypt once.
func (s *Store) Verify(username, password string) (Role, bool) {
	key := credentialKey(username, password)

	s.mu.RLock()
	entry, cached := s.cache[key]
	now := s.now()
	s.mu.RUnlock()

	if cached && now.Before(entry.expiresAt) && entry.username == username {
		return entry.role, true
	}

	s.mu.RLock()
	stored, exists := s.users[username]
	s.mu.RUnlock()

	if !exists {
		// Spend the same time as a real check so a missing user is not
		// distinguishable by response time.
		_ = bcrypt.CompareHashAndPassword([]byte(decoyHash), []byte(password))
		return "", false
	}

	compareErr := bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte(password))
	if compareErr != nil {
		return "", false
	}

	s.mu.Lock()
	s.cache[key] = cacheEntry{username: username, role: stored.Role, expiresAt: now.Add(cacheTTL)}
	s.pruneCacheLocked(now)
	current, stillThere := s.users[username]
	if !stillThere {
		s.mu.Unlock()
		return "", false
	}
	current.LastUsedAt = &now
	s.users[username] = current
	snapshot := s.snapshotLocked()
	s.mu.Unlock()

	// lastUsedAt is written at most once per cacheTTL per credential, so this
	// is not a per-request write. A failure here must not fail the request.
	_ = s.persist(snapshot)
	return current.Role, true
}

// ImportHtpasswd adds users from an htpasswd file that are not in the store
// yet, with role push. Only bcrypt entries are usable; anything else is
// reported through skipped so the caller can log it.
func (s *Store) ImportHtpasswd(path string) (imported int, skipped []string, err error) {
	file, openErr := os.Open(path)
	if openErr != nil {
		return 0, nil, fmt.Errorf("open htpasswd: %w", openErr)
	}
	defer file.Close()

	added := make([]record, 0, 8)
	skipped = make([]string, 0, 4)
	scanner := bufio.NewScanner(file)
	now := s.now()

	for scanner.Scan() {
		raw := scanner.Text()
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, hash, found := strings.Cut(line, ":")
		if !found {
			skipped = append(skipped, line)
			continue
		}
		if !isBcryptHash(hash) {
			skipped = append(skipped, name)
			continue
		}
		if name == s.reserved {
			skipped = append(skipped, name)
			continue
		}
		added = append(added, record{
			Username:     name,
			Role:         RolePush,
			PasswordHash: hash,
			CreatedAt:    now,
			UpdatedAt:    now,
		})
	}
	scanErr := scanner.Err()
	if scanErr != nil {
		return 0, skipped, fmt.Errorf("read htpasswd: %w", scanErr)
	}

	s.mu.Lock()
	for _, candidate := range added {
		_, exists := s.users[candidate.Username]
		if exists {
			continue
		}
		s.users[candidate.Username] = candidate
		imported++
	}
	clear(s.cache)
	snapshot := s.snapshotLocked()
	s.mu.Unlock()

	if imported == 0 {
		return 0, skipped, nil
	}
	persistErr := s.persist(snapshot)
	if persistErr != nil {
		return imported, skipped, persistErr
	}
	return imported, skipped, nil
}

// GeneratePassword returns a fresh random password of generatedPasswordLen
// characters.
func GeneratePassword() (string, error) {
	out := make([]byte, generatedPasswordLen)
	buf := make([]byte, generatedPasswordLen)
	_, readErr := rand.Read(buf)
	if readErr != nil {
		return "", fmt.Errorf("generate password: %w", readErr)
	}
	size := len(passwordAlphabet)
	for i, b := range buf {
		out[i] = passwordAlphabet[int(b)%size]
	}
	return string(out), nil
}

func (s *Store) validateUsername(username string) error {
	matched := usernamePattern.MatchString(username)
	if !matched {
		return fmt.Errorf("%w: %q must match %s", ErrInvalidUsername, username, usernamePattern.String())
	}
	if username == s.reserved {
		return fmt.Errorf("%w: %q is the service principal", ErrReservedUsername, username)
	}
	return nil
}

func (s *Store) snapshotLocked() storeFile {
	records := make([]record, 0, len(s.users))
	for _, stored := range s.users {
		records = append(records, stored)
	}
	slices.SortFunc(records, func(a, b record) int {
		return strings.Compare(a.Username, b.Username)
	})
	return storeFile{Version: storeVersion, Users: records}
}

func (s *Store) pruneCacheLocked(now time.Time) {
	for key, entry := range s.cache {
		if !now.Before(entry.expiresAt) {
			delete(s.cache, key)
		}
	}
}

func (s *Store) persist(snapshot storeFile) error {
	writeErr := atomicio.WriteJSON(s.path, snapshot)
	if writeErr != nil {
		return fmt.Errorf("persist user store: %w", writeErr)
	}
	return nil
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

func credentialKey(username, password string) string {
	sum := sha256.Sum256([]byte(username + ":" + password))
	return hex.EncodeToString(sum[:])
}

func isBcryptHash(hash string) bool {
	prefixes := [...]string{"$2a$", "$2b$", "$2y$"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(hash, prefix) {
			return true
		}
	}
	return false
}

// decoyHash is a valid bcrypt hash of a random value, compared against when the
// user does not exist so that timing does not leak which usernames are real.
const decoyHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
