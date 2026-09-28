package storage

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Repository errors. Callers branch on these, so they are sentinels.
var (
	ErrRepositoryNotFound = errors.New("repository not found")
	ErrRepositoryHasTags  = errors.New("repository still has tags")
	ErrInvalidName        = errors.New("invalid repository name")
)

// namePattern is Distribution's repository name grammar: lowercase path
// components separated by slashes. It also keeps `..` out of a path join.
var namePattern = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$`)

// ValidateName checks a repository name from a request.
func ValidateName(name string) error {
	if name == "" {
		return fmt.Errorf("%w: empty", ErrInvalidName)
	}
	if len(name) > 255 {
		return fmt.Errorf("%w: longer than 255 characters", ErrInvalidName)
	}
	matched := namePattern.MatchString(name)
	if !matched {
		return fmt.Errorf("%w: %q", ErrInvalidName, name)
	}
	return nil
}

// RepositoryPath is the directory holding one repository's links.
func (s *Store) RepositoryPath(name string) (string, error) {
	nameErr := ValidateName(name)
	if nameErr != nil {
		return "", nameErr
	}
	v2 := s.V2Root()
	base := filepath.Join(v2, repositoriesDir)
	path := filepath.Join(base, filepath.FromSlash(name))

	// Belt and braces: the name pattern already excludes traversal.
	withinBase := strings.HasPrefix(path, base+string(filepath.Separator))
	if !withinBase {
		return "", fmt.Errorf("%w: %q escapes the repositories directory", ErrInvalidName, name)
	}
	return path, nil
}

// HasTags reports whether a repository still has at least one tag.
func (s *Store) HasTags(name string) (bool, error) {
	path, pathErr := s.RepositoryPath(name)
	if pathErr != nil {
		return false, pathErr
	}
	tagsPath := filepath.Join(path, manifestsDir, tagsDir)
	return hasEntries(tagsPath)
}

// RemoveRepository deletes a repository's directory so the registry stops
// listing it. It refuses a repository that still has tags unless force is set.
// The blobs stay until the next garbage collection.
func (s *Store) RemoveRepository(name string, force bool) error {
	path, pathErr := s.RepositoryPath(name)
	if pathErr != nil {
		return pathErr
	}
	info, statErr := os.Stat(path)
	if os.IsNotExist(statErr) {
		return ErrRepositoryNotFound
	}
	if statErr != nil {
		return fmt.Errorf("stat repository %s: %w", name, statErr)
	}
	if !info.IsDir() {
		return ErrRepositoryNotFound
	}

	if !force {
		tagged, tagErr := s.HasTags(name)
		if tagErr != nil {
			return tagErr
		}
		if tagged {
			return ErrRepositoryHasTags
		}
	}

	removeErr := os.RemoveAll(path)
	if removeErr != nil {
		return fmt.Errorf("remove repository %s: %w", name, removeErr)
	}
	s.pruneEmptyParents(path)
	s.Invalidate()
	return nil
}

// EmptyRepositories returns repositories the garbage collector has stripped
// bare: no tags, no manifest revisions, no leftover uploads, and no file
// touched within quietFor.
//
// The quiet period is what keeps a push from being deleted underneath itself.
// A repository being pushed to for the first time has its layer links in place
// for the whole gap between the last blob and the manifest PUT, and the write
// gate drains in-flight *requests*, not an in-flight push. Such a repository
// has recent link files, so it is left alone; one the collector has just
// emptied has no files at all and is removed.
//
// Only regular files count towards the quiet period. Directory timestamps
// cannot be used: the collector's own deletions set them to now, which would
// make every repository it just emptied look busy for an hour.
func (s *Store) EmptyRepositories(quietFor time.Duration) ([]string, error) {
	found, err := s.scanRepositories()
	if err != nil {
		return nil, err
	}

	empty := make([]string, 0, len(found))
	for _, repo := range found {
		if repo.hasTags || repo.hasRevisions {
			continue
		}
		busy, busyErr := isRepositoryBusy(repo.path, quietFor)
		if busyErr != nil {
			return nil, busyErr
		}
		if busy {
			continue
		}
		empty = append(empty, repo.name)
	}
	return empty, nil
}

// isRepositoryBusy reports whether a repository shows signs of a push in
// progress: an upload directory, or any file written within quietFor.
func isRepositoryBusy(path string, quietFor time.Duration) (bool, error) {
	uploading, uploadErr := hasEntries(filepath.Join(path, uploadsDir))
	if uploadErr != nil {
		return false, uploadErr
	}
	if uploading {
		return true, nil
	}
	if quietFor <= 0 {
		return false, nil
	}

	cutoff := time.Now().Add(-quietFor)
	recent := false
	walkErr := filepath.WalkDir(path, func(_ string, entry fs.DirEntry, err error) error {
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
		modTime := info.ModTime()
		if modTime.After(cutoff) {
			recent = true
			return filepath.SkipAll
		}
		return nil
	})
	if walkErr != nil {
		return false, fmt.Errorf("check %s for recent writes: %w", path, walkErr)
	}
	return recent, nil
}

type repositoryEntry struct {
	name         string
	path         string
	hasTags      bool
	hasRevisions bool
}

// scanRepositories walks the repositories tree once. A directory is a
// repository when it directly contains _manifests, _layers or _uploads.
func (s *Store) scanRepositories() ([]repositoryEntry, error) {
	v2 := s.V2Root()
	base := filepath.Join(v2, repositoriesDir)
	out := make([]repositoryEntry, 0, 16)

	walkErr := filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return skipUnreadable(err)
		}
		if !entry.IsDir() || path == base {
			return nil
		}
		if strings.HasPrefix(entry.Name(), "_") {
			return filepath.SkipDir
		}
		marker := isRepositoryDir(path)
		if !marker {
			return nil
		}

		rel, relErr := filepath.Rel(base, path)
		if relErr != nil {
			return nil
		}
		tagged, tagErr := hasEntries(filepath.Join(path, manifestsDir, tagsDir))
		if tagErr != nil {
			return tagErr
		}
		revisioned, revErr := hasEntries(filepath.Join(path, manifestsDir, revisionsDir))
		if revErr != nil {
			return revErr
		}
		out = append(out, repositoryEntry{
			name:         filepath.ToSlash(rel),
			path:         path,
			hasTags:      tagged,
			hasRevisions: revisioned,
		})
		return nil
	})
	if walkErr != nil {
		return nil, fmt.Errorf("scan repositories: %w", walkErr)
	}

	slices.SortFunc(out, func(a, b repositoryEntry) int {
		return strings.Compare(a.name, b.name)
	})
	return out, nil
}

// isRepositoryDir reports whether a directory holds a repository's own data.
// A namespace directory (the `team` in `team/app`) holds neither.
func isRepositoryDir(path string) bool {
	markers := [...]string{manifestsDir, layersDir, uploadsDir}
	for _, marker := range markers {
		_, err := os.Stat(filepath.Join(path, marker))
		if err == nil {
			return true
		}
	}
	return false
}

// hasEntries reports whether a directory exists and is not empty. A missing
// directory is empty, not an error.
func hasEntries(path string) (bool, error) {
	handle, openErr := os.Open(path)
	if os.IsNotExist(openErr) {
		return false, nil
	}
	if openErr != nil {
		return false, fmt.Errorf("open %s: %w", path, openErr)
	}
	defer handle.Close()

	names, readErr := handle.Readdirnames(1)
	if readErr != nil && len(names) == 0 {
		// io.EOF on an empty directory is the expected case.
		return false, nil
	}
	return len(names) > 0, nil
}

// pruneEmptyParents removes namespace directories left empty by a removal, up
// to (but not including) the repositories directory.
func (s *Store) pruneEmptyParents(removed string) {
	v2 := s.V2Root()
	base := filepath.Join(v2, repositoriesDir)

	current := filepath.Dir(removed)
	for strings.HasPrefix(current, base+string(filepath.Separator)) {
		// Remove only succeeds on an empty directory, which is exactly the
		// condition we want.
		err := os.Remove(current)
		if err != nil {
			return
		}
		current = filepath.Dir(current)
	}
}
