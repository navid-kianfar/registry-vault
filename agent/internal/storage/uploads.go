package storage

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// startedAtFile is written by the registry when an upload begins.
const startedAtFile = "startedat"

// Upload is one in-progress or abandoned blob upload.
type Upload struct {
	Repository string    `json:"repository"`
	ID         string    `json:"id"`
	StartedAt  time.Time `json:"startedAt"`
	Bytes      int64     `json:"bytes"`
}

// UploadList is the response of GET /api/v1/uploads.
type UploadList struct {
	TotalBytes int64    `json:"totalBytes"`
	Uploads    []Upload `json:"uploads"`
}

// PurgeResult is the response of POST /api/v1/uploads/purge.
type PurgeResult struct {
	Purged     int   `json:"purged"`
	FreedBytes int64 `json:"freedBytes"`
}

// Uploads lists uploads that started at least olderThan ago. A zero or
// negative olderThan lists every upload, which includes ones still running.
func (s *Store) Uploads(olderThan time.Duration) (UploadList, error) {
	found, err := s.scanUploads()
	if err != nil {
		return UploadList{}, err
	}

	cutoff := time.Now().UTC().Add(-olderThan)
	kept := make([]Upload, 0, len(found))
	list := UploadList{}
	for _, upload := range found {
		if olderThan > 0 && upload.StartedAt.After(cutoff) {
			continue
		}
		kept = append(kept, upload)
		list.TotalBytes += upload.Bytes
	}
	list.Uploads = kept
	return list, nil
}

// PurgeUploads removes uploads that started at least olderThan ago. Younger
// uploads are never touched: they may be a push in progress.
func (s *Store) PurgeUploads(olderThan time.Duration) (PurgeResult, error) {
	list, listErr := s.Uploads(olderThan)
	if listErr != nil {
		return PurgeResult{}, listErr
	}

	result := PurgeResult{}
	v2 := s.V2Root()
	for _, upload := range list.Uploads {
		path := filepath.Join(v2, repositoriesDir, filepath.FromSlash(upload.Repository), uploadsDir, upload.ID)
		removeErr := os.RemoveAll(path)
		if removeErr != nil {
			return result, fmt.Errorf("remove upload %s/%s: %w", upload.Repository, upload.ID, removeErr)
		}
		result.Purged++
		result.FreedBytes += upload.Bytes
	}
	if result.Purged > 0 {
		s.Invalidate()
	}
	return result, nil
}

// scanUploads finds every _uploads directory under the repositories tree.
func (s *Store) scanUploads() ([]Upload, error) {
	v2 := s.V2Root()
	base := filepath.Join(v2, repositoriesDir)
	out := make([]Upload, 0, 8)

	walkErr := filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return skipUnreadable(err)
		}
		if !entry.IsDir() || entry.Name() != uploadsDir {
			return nil
		}
		parent := filepath.Dir(path)
		rel, relErr := filepath.Rel(base, parent)
		if relErr != nil {
			return filepath.SkipDir
		}
		repository := filepath.ToSlash(rel)
		collected, collectErr := collectUploads(path, repository)
		if collectErr != nil {
			return collectErr
		}
		out = append(out, collected...)
		return filepath.SkipDir
	})
	if os.IsNotExist(walkErr) {
		return out, nil
	}
	if walkErr != nil {
		return nil, fmt.Errorf("scan uploads: %w", walkErr)
	}

	slices.SortFunc(out, func(a, b Upload) int {
		if a.StartedAt.Equal(b.StartedAt) {
			return strings.Compare(a.ID, b.ID)
		}
		if a.StartedAt.Before(b.StartedAt) {
			return -1
		}
		return 1
	})
	return out, nil
}

func collectUploads(uploadsPath, repository string) ([]Upload, error) {
	entries, readErr := os.ReadDir(uploadsPath)
	if os.IsNotExist(readErr) {
		return nil, nil
	}
	if readErr != nil {
		return nil, fmt.Errorf("read %s: %w", uploadsPath, readErr)
	}

	out := make([]Upload, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(uploadsPath, entry.Name())
		size, sizeErr := directorySize(path)
		if sizeErr != nil {
			return nil, sizeErr
		}
		out = append(out, Upload{
			Repository: repository,
			ID:         entry.Name(),
			StartedAt:  uploadStartedAt(path, entry),
			Bytes:      size,
		})
	}
	return out, nil
}

// uploadStartedAt reads the registry's startedat marker, falling back to the
// directory's modification time when it is missing or unparsable.
func uploadStartedAt(path string, entry fs.DirEntry) time.Time {
	marker := filepath.Join(path, startedAtFile)
	raw, readErr := os.ReadFile(marker)
	if readErr == nil {
		text := strings.TrimSpace(string(raw))
		parsed, parseErr := time.Parse(time.RFC3339, text)
		if parseErr == nil {
			return parsed.UTC()
		}
	}
	info, infoErr := entry.Info()
	if infoErr != nil {
		return time.Time{}
	}
	modTime := info.ModTime()
	return modTime.UTC()
}

func directorySize(path string) (int64, error) {
	var total int64
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
		total += info.Size()
		return nil
	})
	if walkErr != nil {
		return 0, fmt.Errorf("size %s: %w", path, walkErr)
	}
	return total, nil
}
