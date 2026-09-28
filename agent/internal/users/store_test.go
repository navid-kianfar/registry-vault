package users

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const serviceUser = "registry-vault"

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()

	dir := t.TempDir()
	store, err := New(dir, serviceUser)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return store, dir
}

func TestRoleAllows(t *testing.T) {
	cases := []struct {
		name   string
		role   Role
		action Action
		want   bool
	}{
		{"pull reads", RolePull, ActionRead, true},
		{"pull does not write", RolePull, ActionWrite, false},
		{"pull does not delete", RolePull, ActionDelete, false},
		{"pull has no catalog", RolePull, ActionCatalog, false},
		{"push reads", RolePush, ActionRead, true},
		{"push writes", RolePush, ActionWrite, true},
		{"push does not delete", RolePush, ActionDelete, false},
		{"push has no catalog", RolePush, ActionCatalog, false},
		{"admin reads", RoleAdmin, ActionRead, true},
		{"admin writes", RoleAdmin, ActionWrite, true},
		{"admin deletes", RoleAdmin, ActionDelete, true},
		{"admin has the catalog", RoleAdmin, ActionCatalog, true},
		{"an unknown role may do nothing", Role("root"), ActionRead, false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := testCase.role.Allows(testCase.action)
			if got != testCase.want {
				t.Fatalf("Allows = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestParseRoleRejectsUnknownRoles(t *testing.T) {
	_, err := ParseRole("superuser")
	if !errors.Is(err, ErrInvalidRole) {
		t.Fatalf("error = %v, want ErrInvalidRole", err)
	}
}

func TestCreateAndVerify(t *testing.T) {
	store, _ := newTestStore(t)

	created, generated, err := store.Create("ci", RolePush, "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(generated) != generatedPasswordLen {
		t.Fatalf("generated password length = %d, want %d", len(generated), generatedPasswordLen)
	}
	if created.Role != RolePush || created.LastUsedAt != nil {
		t.Fatalf("unexpected user: %+v", created)
	}

	role, ok := store.Verify("ci", generated)
	if !ok || role != RolePush {
		t.Fatalf("Verify = %v, %v; want push, true", role, ok)
	}

	_, wrongOK := store.Verify("ci", "not-the-password")
	if wrongOK {
		t.Fatal("expected a wrong password to be rejected")
	}
	_, missingOK := store.Verify("nobody", generated)
	if missingOK {
		t.Fatal("expected an unknown user to be rejected")
	}

	listed := store.List()
	if len(listed) != 1 {
		t.Fatalf("List returned %d users, want 1", len(listed))
	}
	if listed[0].LastUsedAt == nil {
		t.Fatal("expected lastUsedAt to be set after a successful verification")
	}
}

func TestCreateRejectsBadInput(t *testing.T) {
	store, _ := newTestStore(t)

	cases := []struct {
		name     string
		username string
		password string
		want     error
	}{
		{"uppercase", "CI", "correct horse battery", ErrInvalidUsername},
		{"too short", "a", "correct horse battery", ErrInvalidUsername},
		{"leading dash", "-ci", "correct horse battery", ErrInvalidUsername},
		{"service principal", serviceUser, "correct horse battery", ErrReservedUsername},
		{"short password", "ci", "short", ErrPasswordTooShort},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, _, err := store.Create(testCase.username, RolePush, testCase.password)
			if !errors.Is(err, testCase.want) {
				t.Fatalf("error = %v, want %v", err, testCase.want)
			}
		})
	}
}

func TestCreateRejectsDuplicates(t *testing.T) {
	store, _ := newTestStore(t)

	_, _, err := store.Create("ci", RolePush, "correct horse battery")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	_, _, again := store.Create("ci", RolePull, "correct horse battery")
	if !errors.Is(again, ErrExists) {
		t.Fatalf("error = %v, want ErrExists", again)
	}
}

func TestUpdateChangesRoleAndPasswordImmediately(t *testing.T) {
	store, _ := newTestStore(t)

	_, _, err := store.Create("ci", RolePush, "correct horse battery")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	role, ok := store.Verify("ci", "correct horse battery")
	if !ok || role != RolePush {
		t.Fatalf("Verify = %v, %v", role, ok)
	}

	pull := RolePull
	updated, _, updateErr := store.Update("ci", Changes{Role: &pull})
	if updateErr != nil {
		t.Fatalf("Update: %v", updateErr)
	}
	if updated.Role != RolePull {
		t.Fatalf("role = %v, want pull", updated.Role)
	}

	// The cached verification must not outlive the change.
	cachedRole, stillOK := store.Verify("ci", "correct horse battery")
	if !stillOK || cachedRole != RolePull {
		t.Fatalf("Verify after role change = %v, %v; want pull, true", cachedRole, stillOK)
	}

	_, generated, resetErr := store.Update("ci", Changes{ResetPassword: true})
	if resetErr != nil {
		t.Fatalf("Update reset: %v", resetErr)
	}
	if generated == "" {
		t.Fatal("expected a generated password")
	}
	_, oldOK := store.Verify("ci", "correct horse battery")
	if oldOK {
		t.Fatal("expected the old password to stop working")
	}
	_, newOK := store.Verify("ci", generated)
	if !newOK {
		t.Fatal("expected the new password to work")
	}
}

func TestUpdateRejectsPasswordAndResetTogether(t *testing.T) {
	store, _ := newTestStore(t)

	_, _, err := store.Create("ci", RolePush, "correct horse battery")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	password := "another good password"
	_, _, updateErr := store.Update("ci", Changes{Password: &password, ResetPassword: true})
	if !errors.Is(updateErr, ErrBadChange) {
		t.Fatalf("error = %v, want ErrBadChange", updateErr)
	}
}

func TestDeleteRemovesTheUserAndItsCache(t *testing.T) {
	store, _ := newTestStore(t)

	_, _, err := store.Create("ci", RolePush, "correct horse battery")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	_, ok := store.Verify("ci", "correct horse battery")
	if !ok {
		t.Fatal("expected the user to verify")
	}

	deleteErr := store.Delete("ci")
	if deleteErr != nil {
		t.Fatalf("Delete: %v", deleteErr)
	}
	_, stillOK := store.Verify("ci", "correct horse battery")
	if stillOK {
		t.Fatal("expected a deleted user to stop verifying")
	}
	missing := store.Delete("ci")
	if !errors.Is(missing, ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", missing)
	}
}

func TestStoreSurvivesARestart(t *testing.T) {
	store, dir := newTestStore(t)

	_, _, err := store.Create("ci", RoleAdmin, "correct horse battery")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	reloaded, reloadErr := New(dir, serviceUser)
	if reloadErr != nil {
		t.Fatalf("New: %v", reloadErr)
	}
	role, ok := reloaded.Verify("ci", "correct horse battery")
	if !ok || role != RoleAdmin {
		t.Fatalf("Verify after restart = %v, %v", role, ok)
	}
}

// The stored file must never contain a password in clear.
func TestStoredFileHoldsOnlyHashes(t *testing.T) {
	store, dir := newTestStore(t)

	const password = "correct horse battery"
	_, _, err := store.Create("ci", RolePush, password)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	raw, readErr := os.ReadFile(filepath.Join(dir, usersFile))
	if readErr != nil {
		t.Fatalf("read users file: %v", readErr)
	}
	content := string(raw)
	if strings.Contains(content, password) {
		t.Fatal("the user store wrote a password in clear")
	}
	if !strings.Contains(content, "$2a$") {
		t.Fatal("expected a bcrypt hash in the user store")
	}
}

func TestImportHtpasswdAddsOnlyNewBcryptUsers(t *testing.T) {
	store, _ := newTestStore(t)

	_, _, err := store.Create("existing", RoleAdmin, "correct horse battery")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	path := filepath.Join(t.TempDir(), "htpasswd")
	// bcrypt hashes of "correct horse battery" and an unsupported md5 entry.
	content := strings.Join([]string{
		"# a comment",
		"imported:" + hashFor(t, "correct horse battery"),
		"existing:" + hashFor(t, "a different password"),
		"legacy:$apr1$abcdefgh$0123456789abcdefghijkl",
		"broken-line-without-a-colon",
		"",
	}, "\n")
	writeErr := os.WriteFile(path, []byte(content), 0o600)
	if writeErr != nil {
		t.Fatalf("write htpasswd: %v", writeErr)
	}

	imported, skipped, importErr := store.ImportHtpasswd(path)
	if importErr != nil {
		t.Fatalf("ImportHtpasswd: %v", importErr)
	}
	if imported != 1 {
		t.Fatalf("imported = %d, want 1", imported)
	}
	if len(skipped) != 2 {
		t.Fatalf("skipped = %v, want the md5 entry and the malformed line", skipped)
	}

	role, ok := store.Verify("imported", "correct horse battery")
	if !ok || role != RolePush {
		t.Fatalf("Verify imported = %v, %v; want push, true", role, ok)
	}
	// The existing user keeps its own password and role.
	existingRole, existingOK := store.Verify("existing", "correct horse battery")
	if !existingOK || existingRole != RoleAdmin {
		t.Fatalf("Verify existing = %v, %v; want admin, true", existingRole, existingOK)
	}
}

func hashFor(t *testing.T, password string) string {
	t.Helper()

	hash, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hashPassword: %v", err)
	}
	return hash
}
