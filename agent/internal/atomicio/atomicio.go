// Package atomicio writes files so that a reader never sees a half-written
// one: content goes to a temporary file in the same directory, is fsynced, and
// is then renamed over the target.
package atomicio

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	dirPerm  = 0o750
	filePerm = 0o600
)

// WriteFile replaces path with data atomically, creating parent directories.
func WriteFile(path string, data []byte) error {
	dir := filepath.Dir(path)
	mkdirErr := os.MkdirAll(dir, dirPerm)
	if mkdirErr != nil {
		return fmt.Errorf("create %s: %w", dir, mkdirErr)
	}

	pattern := filepath.Base(path) + ".tmp-*"
	temp, createErr := os.CreateTemp(dir, pattern)
	if createErr != nil {
		return fmt.Errorf("create temp file in %s: %w", dir, createErr)
	}
	tempPath := temp.Name()

	// Any failure from here on leaves the original file untouched; the temp
	// file is removed on the way out.
	writeErr := writeAndClose(temp, data)
	if writeErr != nil {
		_ = os.Remove(tempPath)
		return writeErr
	}

	chmodErr := os.Chmod(tempPath, filePerm)
	if chmodErr != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("chmod %s: %w", tempPath, chmodErr)
	}

	renameErr := os.Rename(tempPath, path)
	if renameErr != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("rename %s: %w", tempPath, renameErr)
	}
	return nil
}

// WriteJSON marshals value with indentation and writes it atomically.
func WriteJSON(path string, value any) error {
	data, marshalErr := json.MarshalIndent(value, "", "  ")
	if marshalErr != nil {
		return fmt.Errorf("marshal %s: %w", path, marshalErr)
	}
	withNewline := append(data, '\n')
	return WriteFile(path, withNewline)
}

// ReadJSON decodes path into value. It reports whether the file existed; a
// missing file is not an error, because every store starts empty.
func ReadJSON(path string, value any) (bool, error) {
	data, readErr := os.ReadFile(path)
	if os.IsNotExist(readErr) {
		return false, nil
	}
	if readErr != nil {
		return false, fmt.Errorf("read %s: %w", path, readErr)
	}
	unmarshalErr := json.Unmarshal(data, value)
	if unmarshalErr != nil {
		return true, fmt.Errorf("parse %s: %w", path, unmarshalErr)
	}
	return true, nil
}

func writeAndClose(file *os.File, data []byte) error {
	defer file.Close()

	_, writeErr := file.Write(data)
	if writeErr != nil {
		return fmt.Errorf("write %s: %w", file.Name(), writeErr)
	}
	syncErr := file.Sync()
	if syncErr != nil {
		return fmt.Errorf("sync %s: %w", file.Name(), syncErr)
	}
	return nil
}
