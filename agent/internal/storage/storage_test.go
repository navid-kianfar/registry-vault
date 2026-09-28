package storage

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// digest builds a 64-character hex digest from a marker character.
func digest(marker byte) string {
	return "sha256:" + strings.Repeat(string(marker), 64)
}

func digestHex(d string) string {
	_, hex, _ := strings.Cut(d, ":")
	return hex
}

type fakeTree struct {
	root string
	t    *testing.T
}

func newFakeTree(t *testing.T) *fakeTree {
	t.Helper()
	return &fakeTree{root: t.TempDir(), t: t}
}

func (f *fakeTree) v2() string {
	return filepath.Join(f.root, "docker", "registry", "v2")
}

func (f *fakeTree) write(path string, size int) {
	f.t.Helper()

	dir := filepath.Dir(path)
	mkdirErr := os.MkdirAll(dir, 0o755)
	if mkdirErr != nil {
		f.t.Fatalf("mkdir %s: %v", dir, mkdirErr)
	}
	content := make([]byte, size)
	writeErr := os.WriteFile(path, content, 0o644)
	if writeErr != nil {
		f.t.Fatalf("write %s: %v", path, writeErr)
	}
}

// blob writes a blob of the given size.
func (f *fakeTree) blob(d string, size int) {
	f.t.Helper()

	hex := digestHex(d)
	path := filepath.Join(f.v2(), "blobs", "sha256", hex[:2], hex, "data")
	f.write(path, size)
}

// layerLink links a blob into a repository's layers.
func (f *fakeTree) layerLink(repository, d string) {
	f.t.Helper()

	hex := digestHex(d)
	path := filepath.Join(f.v2(), "repositories", filepath.FromSlash(repository), "_layers", "sha256", hex, "link")
	f.write(path, len(d))
}

// revisionLink links a manifest into a repository's revisions.
func (f *fakeTree) revisionLink(repository, d string) {
	f.t.Helper()

	hex := digestHex(d)
	path := filepath.Join(f.v2(), "repositories", filepath.FromSlash(repository),
		"_manifests", "revisions", "sha256", hex, "link")
	f.write(path, len(d))
}

// tag links a tag to a manifest.
func (f *fakeTree) tag(repository, name, d string) {
	f.t.Helper()

	path := filepath.Join(f.v2(), "repositories", filepath.FromSlash(repository),
		"_manifests", "tags", name, "current", "link")
	f.write(path, len(d))
}

// upload writes an abandoned upload of the given size and age.
func (f *fakeTree) upload(repository, id string, size int, startedAt time.Time) {
	f.t.Helper()

	base := filepath.Join(f.v2(), "repositories", filepath.FromSlash(repository), "_uploads", id)
	f.write(filepath.Join(base, "data"), size)

	stamp := startedAt.UTC().Format(time.RFC3339)
	markerPath := filepath.Join(base, startedAtFile)
	writeErr := os.WriteFile(markerPath, []byte(stamp), 0o644)
	if writeErr != nil {
		f.t.Fatalf("write startedat: %v", writeErr)
	}
}

// emptyLayerTree makes the directory skeleton a garbage collection leaves
// behind once it has deleted every link: directories, no files.
func (f *fakeTree) emptyLayerTree(repository string) {
	f.t.Helper()

	path := filepath.Join(f.v2(), "repositories", filepath.FromSlash(repository), "_layers", "sha256")
	mkdirErr := os.MkdirAll(path, 0o755)
	if mkdirErr != nil {
		f.t.Fatalf("mkdir %s: %v", path, mkdirErr)
	}
}

// age backdates every file in a repository, so a test can say "this has not
// been touched for hours" without waiting.
func (f *fakeTree) age(repository string, by time.Duration) {
	f.t.Helper()

	base := filepath.Join(f.v2(), "repositories", filepath.FromSlash(repository))
	when := time.Now().Add(-by)
	walkErr := filepath.WalkDir(base, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		return os.Chtimes(path, when, when)
	})
	if walkErr != nil {
		f.t.Fatalf("age %s: %v", repository, walkErr)
	}
}

// buildSharedTree makes two repositories: `app` and `team/tool`. They share one
// layer; each has one layer of its own and one manifest.
func buildSharedTree(t *testing.T) *fakeTree {
	t.Helper()

	tree := newFakeTree(t)
	shared := digest('a')
	appOnly := digest('b')
	toolOnly := digest('c')
	appManifest := digest('d')
	toolManifest := digest('e')

	tree.blob(shared, 1000)
	tree.blob(appOnly, 200)
	tree.blob(toolOnly, 300)
	tree.blob(appManifest, 10)
	tree.blob(toolManifest, 20)

	tree.layerLink("app", shared)
	tree.layerLink("app", appOnly)
	tree.revisionLink("app", appManifest)
	tree.tag("app", "1.0.0", appManifest)

	tree.layerLink("team/tool", shared)
	tree.layerLink("team/tool", toolOnly)
	tree.revisionLink("team/tool", toolManifest)
	tree.tag("team/tool", "2.0.0", toolManifest)

	return tree
}

func TestReportSplitsExclusiveAndSharedBytes(t *testing.T) {
	tree := buildSharedTree(t)
	store := New(tree.root)

	report, err := store.Report(true)
	if err != nil {
		t.Fatalf("Report: %v", err)
	}

	if report.Registry.RepositoryCount != 2 {
		t.Fatalf("repositoryCount = %d, want 2", report.Registry.RepositoryCount)
	}
	if report.Registry.BlobBytes != 1530 {
		t.Fatalf("blobBytes = %d, want 1530", report.Registry.BlobBytes)
	}

	byName := make(map[string]Repository, len(report.Repositories))
	for _, repository := range report.Repositories {
		byName[repository.Name] = repository
	}

	app, hasApp := byName["app"]
	if !hasApp {
		t.Fatalf("repositories = %+v, want one named app", report.Repositories)
	}
	// app links: shared (1000, shared), its own layer (200) and its manifest (10).
	if app.ExclusiveBytes != 210 {
		t.Fatalf("app exclusiveBytes = %d, want 210", app.ExclusiveBytes)
	}
	if app.SharedBytes != 1000 {
		t.Fatalf("app sharedBytes = %d, want 1000", app.SharedBytes)
	}
	if app.LayerCount != 2 || app.ManifestCount != 1 {
		t.Fatalf("app counts = %d layers, %d manifests; want 2, 1", app.LayerCount, app.ManifestCount)
	}

	tool, hasTool := byName["team/tool"]
	if !hasTool {
		t.Fatalf("repositories = %+v, want one named team/tool", report.Repositories)
	}
	if tool.ExclusiveBytes != 320 {
		t.Fatalf("team/tool exclusiveBytes = %d, want 320", tool.ExclusiveBytes)
	}
	if tool.SharedBytes != 1000 {
		t.Fatalf("team/tool sharedBytes = %d, want 1000", tool.SharedBytes)
	}
}

// A blob that only one repository links becomes exclusive to the other one once
// the first repository is gone — that is what "what deleting it would free"
// means.
func TestSharedBytesBecomeExclusiveWhenTheOtherRepositoryGoes(t *testing.T) {
	tree := buildSharedTree(t)
	store := New(tree.root)

	removeErr := store.RemoveRepository("team/tool", true)
	if removeErr != nil {
		t.Fatalf("RemoveRepository: %v", removeErr)
	}

	report, err := store.Report(true)
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if len(report.Repositories) != 1 {
		t.Fatalf("repositories = %+v, want only app", report.Repositories)
	}
	app := report.Repositories[0]
	if app.SharedBytes != 0 {
		t.Fatalf("app sharedBytes = %d, want 0", app.SharedBytes)
	}
	if app.ExclusiveBytes != 1210 {
		t.Fatalf("app exclusiveBytes = %d, want 1210", app.ExclusiveBytes)
	}
}

func TestReportCountsUploadsSeparately(t *testing.T) {
	tree := buildSharedTree(t)
	tree.upload("app", "upload-1", 4096, time.Now().Add(-48*time.Hour))
	store := New(tree.root)

	report, err := store.Report(true)
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	// The startedat marker counts too, so the upload total is at least the data.
	if report.Registry.UploadBytes < 4096 {
		t.Fatalf("uploadBytes = %d, want at least 4096", report.Registry.UploadBytes)
	}
	if report.Registry.TotalBytes <= report.Registry.BlobBytes {
		t.Fatalf("totalBytes = %d, want more than the blobs alone (%d)",
			report.Registry.TotalBytes, report.Registry.BlobBytes)
	}
}

func TestUploadsFilterByAge(t *testing.T) {
	tree := buildSharedTree(t)
	tree.upload("app", "old-upload", 1000, time.Now().Add(-48*time.Hour))
	tree.upload("app", "fresh-upload", 2000, time.Now().Add(-10*time.Minute))
	store := New(tree.root)

	cases := []struct {
		name      string
		olderThan time.Duration
		wantIDs   []string
	}{
		{"older than a day", 24 * time.Hour, []string{"old-upload"}},
		{"older than a minute", time.Minute, []string{"fresh-upload", "old-upload"}},
		{"older than a week", 7 * 24 * time.Hour, nil},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			list, err := store.Uploads(testCase.olderThan)
			if err != nil {
				t.Fatalf("Uploads: %v", err)
			}
			if len(list.Uploads) != len(testCase.wantIDs) {
				t.Fatalf("returned %d uploads, want %d: %+v",
					len(list.Uploads), len(testCase.wantIDs), list.Uploads)
			}
			found := make(map[string]bool, len(list.Uploads))
			for _, upload := range list.Uploads {
				found[upload.ID] = true
				if upload.Repository != "app" {
					t.Fatalf("repository = %q, want app", upload.Repository)
				}
			}
			for _, want := range testCase.wantIDs {
				if !found[want] {
					t.Fatalf("expected upload %q in %+v", want, list.Uploads)
				}
			}
		})
	}
}

func TestPurgeUploadsLeavesYoungOnesAlone(t *testing.T) {
	tree := buildSharedTree(t)
	tree.upload("app", "old-upload", 1000, time.Now().Add(-48*time.Hour))
	tree.upload("app", "fresh-upload", 2000, time.Now().Add(-10*time.Minute))
	store := New(tree.root)

	result, err := store.PurgeUploads(24 * time.Hour)
	if err != nil {
		t.Fatalf("PurgeUploads: %v", err)
	}
	if result.Purged != 1 {
		t.Fatalf("purged = %d, want 1", result.Purged)
	}
	if result.FreedBytes < 1000 {
		t.Fatalf("freedBytes = %d, want at least 1000", result.FreedBytes)
	}

	remaining, listErr := store.Uploads(0)
	if listErr != nil {
		t.Fatalf("Uploads: %v", listErr)
	}
	if len(remaining.Uploads) != 1 || remaining.Uploads[0].ID != "fresh-upload" {
		t.Fatalf("remaining uploads = %+v, want only fresh-upload", remaining.Uploads)
	}
}

func TestRemoveRepositoryRefusesTaggedRepositories(t *testing.T) {
	tree := buildSharedTree(t)
	store := New(tree.root)

	err := store.RemoveRepository("app", false)
	if !errors.Is(err, ErrRepositoryHasTags) {
		t.Fatalf("error = %v, want ErrRepositoryHasTags", err)
	}

	missing := store.RemoveRepository("nothing-here", false)
	if !errors.Is(missing, ErrRepositoryNotFound) {
		t.Fatalf("error = %v, want ErrRepositoryNotFound", missing)
	}

	forced := store.RemoveRepository("app", true)
	if forced != nil {
		t.Fatalf("forced removal: %v", forced)
	}
	_, statErr := os.Stat(filepath.Join(tree.v2(), "repositories", "app"))
	if !os.IsNotExist(statErr) {
		t.Fatal("expected the repository directory to be gone")
	}
}

func TestRemoveRepositoryPrunesEmptyNamespaces(t *testing.T) {
	tree := buildSharedTree(t)
	store := New(tree.root)

	err := store.RemoveRepository("team/tool", true)
	if err != nil {
		t.Fatalf("RemoveRepository: %v", err)
	}
	_, statErr := os.Stat(filepath.Join(tree.v2(), "repositories", "team"))
	if !os.IsNotExist(statErr) {
		t.Fatal("expected the empty namespace directory to be pruned")
	}
}

func TestValidateNameRejectsTraversal(t *testing.T) {
	cases := []string{"../etc", "app/../..", "/absolute", "UPPER", "", "app//sub"}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			err := ValidateName(name)
			if !errors.Is(err, ErrInvalidName) {
				t.Fatalf("ValidateName(%q) = %v, want ErrInvalidName", name, err)
			}
		})
	}
}

func TestEmptyRepositoriesFindsOnlyStrippedOnes(t *testing.T) {
	tree := buildSharedTree(t)
	// A repository left behind by a collection: layers linked, no tags and no
	// revisions, and untouched for long enough.
	tree.layerLink("stale", digest('f'))
	tree.age("stale", 3*time.Hour)
	store := New(tree.root)

	empty, err := store.EmptyRepositories(time.Hour)
	if err != nil {
		t.Fatalf("EmptyRepositories: %v", err)
	}
	if len(empty) != 1 || empty[0] != "stale" {
		t.Fatalf("EmptyRepositories = %v, want [stale]", empty)
	}
}

// The sweep must never delete a repository that is being pushed to. Between a
// push's last blob and its manifest PUT the repository looks exactly like a
// collected one — tags and revisions are both absent — and the write gate
// drains in-flight requests, not an in-flight push.
func TestEmptyRepositoriesLeavesPushesInProgressAlone(t *testing.T) {
	tree := newFakeTree(t)

	// Just collected: the links are gone, only empty directories remain.
	tree.emptyLayerTree("collected")
	// Mid-push: layer links written a moment ago, manifest not in yet.
	tree.layerLink("pushing", digest('a'))
	// Mid-push, earlier still: an upload in flight and nothing else.
	tree.upload("uploading", "upload-1", 1024, time.Now())
	// An upload that has been sitting there for days still means the
	// repository is not the collector's to delete.
	tree.upload("interrupted", "upload-2", 1024, time.Now().Add(-72*time.Hour))
	tree.age("interrupted", 72*time.Hour)
	// Abandoned long ago: links, no manifests, nothing recent.
	tree.layerLink("abandoned", digest('b'))
	tree.age("abandoned", 3*time.Hour)

	store := New(tree.root)
	empty, err := store.EmptyRepositories(time.Hour)
	if err != nil {
		t.Fatalf("EmptyRepositories: %v", err)
	}

	slices.Sort(empty)
	want := []string{"abandoned", "collected"}
	if !slices.Equal(empty, want) {
		t.Fatalf("EmptyRepositories = %v, want %v", empty, want)
	}

	// Both guards have to carry their own weight. Without a quiet period the
	// mid-push repository becomes eligible again — that is the guard that
	// protects it — while the two with uploads stay protected regardless.
	withoutQuietPeriod, zeroErr := store.EmptyRepositories(0)
	if zeroErr != nil {
		t.Fatalf("EmptyRepositories(0): %v", zeroErr)
	}
	slices.Sort(withoutQuietPeriod)
	wantWithoutQuietPeriod := []string{"abandoned", "collected", "pushing"}
	if !slices.Equal(withoutQuietPeriod, wantWithoutQuietPeriod) {
		t.Fatalf("EmptyRepositories(0) = %v, want %v", withoutQuietPeriod, wantWithoutQuietPeriod)
	}
}

// The collector's own deletions set directory timestamps to now, so only file
// timestamps may count towards the quiet period — otherwise the sweep would
// never remove anything it had just emptied.
func TestEmptyRepositoriesIgnoresDirectoryTimestamps(t *testing.T) {
	tree := newFakeTree(t)
	tree.emptyLayerTree("collected")

	path := filepath.Join(tree.v2(), "repositories", "collected", "_layers", "sha256")
	now := time.Now()
	chtimesErr := os.Chtimes(path, now, now)
	if chtimesErr != nil {
		t.Fatalf("chtimes: %v", chtimesErr)
	}

	store := New(tree.root)
	empty, err := store.EmptyRepositories(time.Hour)
	if err != nil {
		t.Fatalf("EmptyRepositories: %v", err)
	}
	if len(empty) != 1 || empty[0] != "collected" {
		t.Fatalf("EmptyRepositories = %v, want [collected]", empty)
	}
}

func TestBlobSize(t *testing.T) {
	tree := buildSharedTree(t)
	store := New(tree.root)

	size, found := store.BlobSize(digest('a'))
	if !found || size != 1000 {
		t.Fatalf("BlobSize = %d, %v; want 1000, true", size, found)
	}
	_, missing := store.BlobSize(digest('z'))
	if missing {
		t.Fatal("expected an unknown digest to be reported as missing")
	}
	_, malformed := store.BlobSize("not-a-digest")
	if malformed {
		t.Fatal("expected a malformed digest to be reported as missing")
	}
}

func TestReportIsCachedUntilRefreshed(t *testing.T) {
	tree := buildSharedTree(t)
	store := New(tree.root)

	first, err := store.Report(false)
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	tree.blob(digest('9'), 500)

	cached, cachedErr := store.Report(false)
	if cachedErr != nil {
		t.Fatalf("Report: %v", cachedErr)
	}
	if cached.Registry.BlobBytes != first.Registry.BlobBytes {
		t.Fatal("expected the second read to come from the cache")
	}

	fresh, freshErr := store.Report(true)
	if freshErr != nil {
		t.Fatalf("Report: %v", freshErr)
	}
	if fresh.Registry.BlobBytes != first.Registry.BlobBytes+500 {
		t.Fatalf("blobBytes = %d, want %d", fresh.Registry.BlobBytes, first.Registry.BlobBytes+500)
	}
}
