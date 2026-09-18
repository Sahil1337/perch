package server

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"perch/httpx"
	"perch/protocol"
)

// Listing folders for the workspace picker. Deliberately not scoped to the configured
// workspaces: its whole job is to find a folder that is not one yet. Read-only, and it returns
// names, never contents — the file API's scoping is untouched by it.
func (s *Server) registerBrowse() {
	s.handle("GET /api/browse", func(w http.ResponseWriter, r *http.Request) error {
		result, err := browseDirectory(r.URL.Query().Get("path"))
		if err != nil {
			return err
		}
		return httpx.JSON(w, result)
	})
}

func browseDirectory(target string) (protocol.BrowseResult, error) {
	var zero protocol.BrowseResult
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	requested := strings.TrimSpace(target)
	if requested == "" {
		requested = home
	}
	if strings.ContainsRune(requested, 0) {
		return zero, httpx.BadRequest("invalid path")
	}

	resolved, err := filepath.Abs(requested)
	if err != nil {
		return zero, httpx.BadRequest("invalid path")
	}
	dirents, err := os.ReadDir(resolved)
	if err != nil {
		switch {
		case errors.Is(err, fs.ErrNotExist):
			return zero, httpx.NotFound("No such folder: " + resolved)
		case errors.Is(err, syscall.ENOTDIR):
			return zero, httpx.BadRequest("Not a folder: " + resolved)
		case errors.Is(err, fs.ErrPermission):
			return zero, httpx.BadRequest("Not readable: " + resolved)
		}
		return zero, err
	}

	entries := make([]protocol.BrowseEntry, 0, len(dirents))
	for _, dirent := range dirents {
		// Dotfolders are noise in a picker; someone who wants one can still type the path.
		if !dirent.IsDir() || IsHidden(dirent.Name()) {
			continue
		}
		entries = append(entries, protocol.BrowseEntry{
			Name: dirent.Name(),
			Path: filepath.Join(resolved, dirent.Name()),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})

	result := protocol.BrowseResult{Path: resolved, Home: home, Entries: entries}
	if parent := filepath.Dir(resolved); parent != resolved {
		result.Parent = &parent
	}
	return result, nil
}
