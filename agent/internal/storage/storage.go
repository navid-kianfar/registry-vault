// Package storage reads and maintains the registry's filesystem storage: disk
// accounting, per-repository exclusive and shared bytes, leftover uploads and
// repository directory removal.
//
// The layout it reads is the Distribution filesystem driver's:
//
//	<root>/docker/registry/v2/blobs/<algo>/<prefix>/<hex>/data
//	<root>/docker/registry/v2/repositories/<name>/_layers/<algo>/<hex>/link
//	<root>/docker/registry/v2/repositories/<name>/_manifests/revisions/<algo>/<hex>/link
//	<root>/docker/registry/v2/repositories/<name>/_manifests/tags/<tag>/current/link
//	<root>/docker/registry/v2/repositories/<name>/_uploads/<id>/data
package storage

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	// cacheTTL is how long a computed report is served without re-walking.
	cacheTTL = 60 * time.Second

	blobsDir        = "blobs"
	repositoriesDir = "repositories"
	layersDir       = "_layers"
	manifestsDir    = "_manifests"
	uploadsDir      = "_uploads"
	revisionsDir    = "revisions"
	tagsDir         = "tags"

	linkFile = "link"
	dataFile = "data"
)

// Disk is the filesystem holding the storage root.
type Disk struct {
	TotalBytes  int64   `json:"totalBytes"`
	UsedBytes   int64   `json:"usedBytes"`
	FreeBytes   int64   `json:"freeBytes"`
	UsedPercent float64 `json:"usedPercent"`
}

// Usage is what the registry itself occupies.
type Usage struct {
	TotalBytes      int64 `json:"totalBytes"`
	BlobBytes       int64 `json:"blobBytes"`
	UploadBytes     int64 `json:"uploadBytes"`
	RepositoryCount int   `json:"repositoryCount"`
}

// Repository is one repository's share of the blobs.
//
// ExclusiveBytes counts blobs only this repository links — what removing it
// would free after a garbage collection. SharedBytes counts blobs other
// repositories link too.
type Repository struct {
	Name           string `json:"name"`
	ExclusiveBytes int64  `json:"exclusiveBytes"`
	SharedBytes    int64  `json:"sharedBytes"`
	LayerCount     int    `json:"layerCount"`
	ManifestCount  int    `json:"manifestCount"`
}

// Report is the response of GET /api/v1/storage.
type Report struct {
	ComputedAt   time.Time    `json:"computedAt"`
	Disk         Disk         `json:"disk"`
	Registry     Usage        `json:"registry"`
	Repositories []Repository `json:"repositories"`
}

// Store reads one registry storage root and caches the last report.
type Store struct {
	root string

	mu     sync.Mutex
	cached *Report
}

// New returns a Store for the given storage root.
func New(root string) *Store {
	return &Store{root: root}
}

// Root is the configured storage root.
func (s *Store) Root() string {
	return s.root
}

// V2Root is the versioned subtree the registry writes into.
func (s *Store) V2Root() string {
	return filepath.Join(s.root, "docker", "registry", "v2")
}

// Report returns the storage report, recomputing it when the cache is older
// than cacheTTL or when refresh is set.
func (s *Store) Report(refresh bool) (Report, error) {
	s.mu.Lock()
	cached := s.cached
	s.mu.Unlock()

	if !refresh && cached != nil {
		age := time.Since(cached.ComputedAt)
		if age < cacheTTL {
			return cached.clone(), nil
		}
	}

	fresh, err := s.compute()
	if err != nil {
		return Report{}, err
	}

	s.mu.Lock()
	s.cached = &fresh
	s.mu.Unlock()
	return fresh.clone(), nil
}

// Invalidate drops the cached report, so the next read walks the tree. Call it
// after anything that changes storage.
func (s *Store) Invalidate() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cached = nil
}

// DiskUsage reports the filesystem holding the storage root.
func (s *Store) DiskUsage() (Disk, error) {
	return diskUsage(s.root)
}

// UsedBytes is the registry's own total, computed without the per-repository
// breakdown. GC uses it for before/after numbers.
func (s *Store) UsedBytes() (int64, error) {
	var total int64
	walkErr := filepath.WalkDir(s.root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return skipUnreadable(err)
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return skipUnreadable(infoErr)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		total += info.Size()
		return nil
	})
	if walkErr != nil {
		return 0, fmt.Errorf("walk storage root: %w", walkErr)
	}
	return total, nil
}

// BlobSize returns the size of one blob, and whether it exists.
func (s *Store) BlobSize(digest string) (int64, bool) {
	path, ok := s.blobPath(digest)
	if !ok {
		return 0, false
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, false
	}
	return info.Size(), true
}

func (s *Store) blobPath(digest string) (string, bool) {
	algo, hex, found := strings.Cut(digest, ":")
	if !found || algo == "" || len(hex) < 2 {
		return "", false
	}
	if strings.ContainsAny(digest, "/\\") {
		return "", false
	}
	v2 := s.V2Root()
	path := filepath.Join(v2, blobsDir, algo, hex[:2], hex, dataFile)
	return path, true
}

// accumulator collects everything the walk finds, so the tree is read once.
type accumulator struct {
	totalBytes  int64
	blobBytes   int64
	uploadBytes int64

	blobSizes map[string]int64
	repos     map[string]*repoAccumulator
}

type repoAccumulator struct {
	digests       map[string]struct{}
	layerCount    int
	manifestCount int
	tags          map[string]struct{}
}

func newAccumulator() *accumulator {
	return &accumulator{
		blobSizes: make(map[string]int64),
		repos:     make(map[string]*repoAccumulator),
	}
}

func (a *accumulator) repo(name string) *repoAccumulator {
	existing, ok := a.repos[name]
	if ok {
		return existing
	}
	fresh := &repoAccumulator{
		digests: make(map[string]struct{}),
		tags:    make(map[string]struct{}),
	}
	a.repos[name] = fresh
	return fresh
}

func (s *Store) compute() (Report, error) {
	acc := newAccumulator()
	v2 := s.V2Root()

	walkErr := filepath.WalkDir(s.root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return skipUnreadable(err)
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return skipUnreadable(infoErr)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		size := info.Size()
		acc.totalBytes += size

		rel, relErr := filepath.Rel(v2, path)
		if relErr != nil || strings.HasPrefix(rel, "..") {
			return nil
		}
		parts := strings.Split(rel, string(filepath.Separator))
		classify(acc, parts, entry.Name(), size)
		return nil
	})
	if walkErr != nil {
		return Report{}, fmt.Errorf("walk storage root: %w", walkErr)
	}

	disk, diskErr := diskUsage(s.root)
	if diskErr != nil {
		return Report{}, diskErr
	}

	report := Report{
		ComputedAt: time.Now().UTC(),
		Disk:       disk,
		Registry: Usage{
			TotalBytes:      acc.totalBytes,
			BlobBytes:       acc.blobBytes,
			UploadBytes:     acc.uploadBytes,
			RepositoryCount: len(acc.repos),
		},
		Repositories: acc.repositories(),
	}
	return report, nil
}

// classify routes one file under the v2 root into the accumulator.
func classify(acc *accumulator, parts []string, name string, size int64) {
	if len(parts) < 2 {
		return
	}
	switch parts[0] {
	case blobsDir:
		classifyBlob(acc, parts, name, size)
	case repositoriesDir:
		classifyRepository(acc, parts, name, size)
	}
}

// classifyBlob handles blobs/<algo>/<prefix>/<hex>/data.
func classifyBlob(acc *accumulator, parts []string, name string, size int64) {
	if name != dataFile || len(parts) != 5 {
		return
	}
	digest := parts[1] + ":" + parts[3]
	acc.blobSizes[digest] = size
	acc.blobBytes += size
}

// classifyRepository handles everything under repositories/<name>/_<section>/…
// The repository name is every component before the first one starting with an
// underscore; registry names cannot contain such a component.
func classifyRepository(acc *accumulator, parts []string, name string, size int64) {
	sectionIndex := -1
	for index := 1; index < len(parts); index++ {
		if strings.HasPrefix(parts[index], "_") {
			sectionIndex = index
			break
		}
	}
	if sectionIndex < 2 {
		return
	}
	nameParts := parts[1:sectionIndex]
	repoName := strings.Join(nameParts, "/")
	rest := parts[sectionIndex+1:]
	repo := acc.repo(repoName)

	switch parts[sectionIndex] {
	case layersDir:
		// _layers/<algo>/<hex>/link
		if name != linkFile || len(rest) != 3 {
			return
		}
		digest := rest[0] + ":" + rest[1]
		repo.digests[digest] = struct{}{}
		repo.layerCount++
	case manifestsDir:
		classifyManifest(repo, rest, name)
	case uploadsDir:
		acc.uploadBytes += size
	}
}

func classifyManifest(repo *repoAccumulator, rest []string, name string) {
	if len(rest) == 0 {
		return
	}
	switch rest[0] {
	case revisionsDir:
		// revisions/<algo>/<hex>/link
		if name != linkFile || len(rest) != 4 {
			return
		}
		digest := rest[1] + ":" + rest[2]
		repo.digests[digest] = struct{}{}
		repo.manifestCount++
	case tagsDir:
		// tags/<tag>/current/link and tags/<tag>/index/<algo>/<hex>/link
		if len(rest) < 2 {
			return
		}
		repo.tags[rest[1]] = struct{}{}
	}
}

// repositories turns the accumulator into the sorted report rows, splitting
// each repository's blobs into exclusive and shared.
func (a *accumulator) repositories() []Repository {
	refCount := make(map[string]int, len(a.blobSizes))
	for _, repo := range a.repos {
		for digest := range repo.digests {
			refCount[digest]++
		}
	}

	names := make([]string, 0, len(a.repos))
	for name := range a.repos {
		names = append(names, name)
	}
	slices.Sort(names)

	out := make([]Repository, len(names))
	for index, name := range names {
		repo := a.repos[name]
		row := Repository{
			Name:          name,
			LayerCount:    repo.layerCount,
			ManifestCount: repo.manifestCount,
		}
		for digest := range repo.digests {
			size := a.blobSizes[digest]
			if refCount[digest] > 1 {
				row.SharedBytes += size
				continue
			}
			row.ExclusiveBytes += size
		}
		out[index] = row
	}
	return out
}

func (r Report) clone() Report {
	copied := r
	copied.Repositories = slices.Clone(r.Repositories)
	return copied
}

// skipUnreadable lets the walk continue past a file that vanished or cannot be
// read — the registry writes and deletes under us — while still failing on a
// genuinely broken root.
func skipUnreadable(err error) error {
	if os.IsNotExist(err) || os.IsPermission(err) {
		return nil
	}
	return err
}
