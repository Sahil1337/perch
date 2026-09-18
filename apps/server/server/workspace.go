package server

import (
	"errors"
	"io/fs"
	"path/filepath"
	"strings"
	"syscall"

	"perch/httpx"
	"perch/storage"
)

const SQLExt = ".sql"

// Never useful in a SQL workspace listing; also skipped by the watcher.
var skippedDirs = map[string]bool{
	"node_modules": true, "dist": true, "build": true, "target": true, "__pycache__": true,
}

func IsSQLFile(name string) bool {
	return strings.HasSuffix(strings.ToLower(name), SQLExt)
}

func IsHidden(name string) bool {
	return strings.HasPrefix(name, ".")
}

// realpathOrClosest resolves as much of target as exists and re-appends the missing tail, so a
// file about to be created can be checked while symlinks in the existing part still resolve.
func realpathOrClosest(target string) (string, error) {
	current, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	var tail []string
	for {
		real, err := filepath.EvalSymlinks(current)
		if err == nil {
			if len(tail) == 0 {
				return real, nil
			}
			return filepath.Join(append([]string{real}, tail...)...), nil
		}
		if !errors.Is(err, fs.ErrNotExist) && !errors.Is(err, syscall.ENOTDIR) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return filepath.Join(append([]string{current}, tail...)...), nil
		}
		tail = append([]string{filepath.Base(current)}, tail...)
		current = parent
	}
}

func contains(root, candidate string) bool {
	if candidate == root {
		return true
	}
	prefix := root
	if !strings.HasSuffix(prefix, string(filepath.Separator)) {
		prefix += string(filepath.Separator)
	}
	return strings.HasPrefix(candidate, prefix)
}

// ResolveRoots realpaths the roots, dropping the ones that no longer exist — a deleted workspace
// simply grants nothing.
func ResolveRoots(roots []string) []string {
	out := make([]string, 0, len(roots))
	for _, root := range roots {
		if root == "" {
			continue
		}
		abs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		real, err := filepath.EvalSymlinks(abs)
		if err != nil {
			continue
		}
		if !slicesContains(out, real) {
			out = append(out, real)
		}
	}
	return out
}

func slicesContains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// WorkspaceRoots is settings.workspaces, realpathed. Roots are realpathed like the paths under
// them: a root reported as /tmp/x whose files come back under /private/tmp/x reads as two
// workspaces.
func (s *Server) WorkspaceRoots() ([]string, error) {
	settings, err := storage.GetSettings()
	if err != nil {
		return nil, err
	}
	return ResolveRoots(settings.Workspaces), nil
}

// SafePath resolves a client-supplied path and guarantees it sits inside a workspace root,
// realpathing both sides so `..` and symlinks cannot escape.
func (s *Server) SafePath(p string, kind string) (string, error) {
	if p == "" {
		return "", httpx.BadRequest("path is required")
	}
	if strings.ContainsRune(p, 0) {
		return "", httpx.BadRequest("invalid path")
	}
	roots, err := s.WorkspaceRoots()
	if err != nil {
		return "", err
	}
	if len(roots) == 0 {
		return "", httpx.Forbidden("no workspace directories are configured")
	}
	resolved, err := realpathOrClosest(p)
	if err != nil {
		return "", err
	}
	inside := false
	for _, root := range roots {
		if contains(root, resolved) {
			inside = true
			break
		}
	}
	if !inside {
		return "", httpx.Forbidden("path is outside the allowed workspaces: " + p)
	}
	if kind != "dir" && !IsSQLFile(resolved) {
		return "", httpx.BadRequest("only .sql files can be read or written")
	}
	return resolved, nil
}

// SafeFileName rejects names that would traverse, hide, or land outside .sql.
func SafeFileName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", httpx.BadRequest("name is required")
	}
	if trimmed != filepath.Base(trimmed) || trimmed == "." || trimmed == ".." {
		return "", httpx.BadRequest("name must not contain path separators")
	}
	if IsHidden(trimmed) {
		return "", httpx.BadRequest("name must not be hidden")
	}
	if !IsSQLFile(trimmed) {
		trimmed += SQLExt
	}
	if strings.ContainsRune(trimmed, 0) {
		return "", httpx.BadRequest("invalid name")
	}
	return trimmed, nil
}
