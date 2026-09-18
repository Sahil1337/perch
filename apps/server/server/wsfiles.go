package server

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"perch/fsx"
	"perch/httpx"
	"perch/protocol"
)

// A 409 carries the file's current text back inline only while it is small enough to be cheap.
const conflictContentLimit = 512 * 1024

// Nothing here checks permissions: callers pass paths SafePath has already vouched for.

func entryFor(full string) (protocol.FileEntry, error) {
	info, err := os.Stat(full)
	if err != nil {
		return protocol.FileEntry{}, err
	}
	return toEntry(full, info), nil
}

func toEntry(full string, info os.FileInfo) protocol.FileEntry {
	entry := protocol.FileEntry{
		Path:       full,
		Name:       filepath.Base(full),
		Kind:       protocol.FileKindFile,
		ModifiedAt: protocol.ISOTime(info.ModTime()),
	}
	if info.IsDir() {
		entry.Kind = protocol.FileKindDir
		return entry
	}
	size := info.Size()
	entry.Size = &size
	return entry
}

// listDir returns directories and .sql files only; hidden entries and symlinks are skipped, and
// directories sort first.
func listDir(dir string) ([]protocol.FileEntry, error) {
	dirents, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, httpx.NotFound("no such directory: " + dir)
		}
		if errors.Is(err, syscall.ENOTDIR) {
			return nil, httpx.BadRequest("not a directory: " + dir)
		}
		return nil, err
	}

	out := make([]protocol.FileEntry, 0, len(dirents))
	for _, dirent := range dirents {
		name := dirent.Name()
		if IsHidden(name) || dirent.Type()&os.ModeSymlink != 0 {
			continue
		}
		isDir := dirent.IsDir()
		if isDir && skippedDirs[name] {
			continue
		}
		if !isDir && !(dirent.Type().IsRegular() && IsSQLFile(name)) {
			continue
		}
		full := filepath.Join(dir, name)
		info, err := os.Stat(full)
		if err != nil {
			continue // vanished between readdir and stat
		}
		out = append(out, toEntry(full, info))
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind == protocol.FileKindDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func readTextFile(full string) (string, string, error) {
	data, err := os.ReadFile(full)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", "", httpx.NotFound("no such file: " + full)
		}
		return "", "", err
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", "", err
	}
	return string(data), protocol.ISOTime(info.ModTime()), nil
}

// writeSQLFile writes via temp file + rename and returns the new mtime, the client's next
// ifModifiedAt.
func writeSQLFile(full, content string) (string, error) {
	if err := fsx.WriteAtomic(full, []byte(content), 0o644); err != nil {
		return "", err
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", err
	}
	return protocol.ISOTime(info.ModTime()), nil
}

func fileExists(full string) bool {
	_, err := os.Stat(full)
	return err == nil
}

// staleWrite reports what a 409 should carry when the file changed under the client's feet, or
// nil when the write may proceed.
func staleWrite(full, ifModifiedAt string) map[string]any {
	var modifiedAt any
	var size int64
	present := false

	if info, err := os.Stat(full); err == nil {
		present = true
		size = info.Size()
		stamp := protocol.ISOTime(info.ModTime())
		if stamp == ifModifiedAt {
			return nil
		}
		modifiedAt = stamp
	}
	if !present && ifModifiedAt == "" {
		return nil
	}

	details := map[string]any{"modifiedAt": modifiedAt}
	if present {
		details["size"] = size
		if size < conflictContentLimit {
			if content, _, err := readTextFile(full); err == nil {
				details["content"] = content
			}
		}
	}
	return details
}
