package server

import (
	"net/http"
	"os"
	"path/filepath"

	"perch/httpx"
	"perch/protocol"
)

// Every client-supplied path goes through SafePath, which realpaths the roots and the target
// before anything touches the disk.
func (s *Server) registerFiles() {
	s.handle("GET /api/files", func(w http.ResponseWriter, r *http.Request) error {
		dir := r.URL.Query().Get("dir")
		if dir == "" {
			// No dir given: hand back the workspace roots themselves.
			roots, err := s.WorkspaceRoots()
			if err != nil {
				return err
			}
			entries := make([]protocol.FileEntry, 0, len(roots))
			for _, root := range roots {
				if entry, err := entryFor(root); err == nil {
					entries = append(entries, entry)
				}
			}
			return httpx.JSON(w, entries)
		}
		full, err := s.SafePath(dir, "dir")
		if err != nil {
			return err
		}
		entries, err := listDir(full)
		if err != nil {
			return err
		}
		return httpx.JSON(w, entries)
	})

	s.handle("GET /api/files/content", func(w http.ResponseWriter, r *http.Request) error {
		full, err := s.SafePath(r.URL.Query().Get("path"), "file")
		if err != nil {
			return err
		}
		content, modifiedAt, err := readTextFile(full)
		if err != nil {
			return err
		}
		return httpx.JSON(w, map[string]any{"path": full, "content": content, "modifiedAt": modifiedAt})
	})

	s.handle("PUT /api/files/content", func(w http.ResponseWriter, r *http.Request) error {
		var body struct {
			Path         string `json:"path"`
			Content      string `json:"content"`
			IfModifiedAt string `json:"ifModifiedAt"`
		}
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
		full, err := s.SafePath(body.Path, "file")
		if err != nil {
			return err
		}
		if body.IfModifiedAt != "" {
			if stale := staleWrite(full, body.IfModifiedAt); stale != nil {
				return httpx.Conflict("the file changed on disk since it was read", stale, "stale_write")
			}
		}
		modifiedAt, err := writeSQLFile(full, body.Content)
		if err != nil {
			return err
		}
		// Our own write must not come back to the client as an external change.
		s.expectWrite(full, modifiedAt)
		return httpx.JSON(w, map[string]any{"path": full, "modifiedAt": modifiedAt})
	})

	s.handle("POST /api/files", func(w http.ResponseWriter, r *http.Request) error {
		var body struct {
			Dir  string `json:"dir"`
			Name string `json:"name"`
		}
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
		dir, err := s.SafePath(body.Dir, "dir")
		if err != nil {
			return err
		}
		name, err := SafeFileName(body.Name)
		if err != nil {
			return err
		}
		full, err := s.SafePath(filepath.Join(dir, name), "file")
		if err != nil {
			return err
		}
		if fileExists(full) {
			return httpx.Conflict(name+" already exists", nil)
		}
		modifiedAt, err := writeSQLFile(full, "")
		if err != nil {
			return err
		}
		s.expectWrite(full, modifiedAt)
		entry, err := entryFor(full)
		if err != nil {
			return err
		}
		return httpx.JSON(w, entry, http.StatusCreated)
	})

	s.handle("POST /api/files/rename", func(w http.ResponseWriter, r *http.Request) error {
		var body struct {
			Path string `json:"path"`
			Name string `json:"name"`
		}
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
		full, err := s.SafePath(body.Path, "file")
		if err != nil {
			return err
		}
		name, err := SafeFileName(body.Name)
		if err != nil {
			return err
		}
		target, err := s.SafePath(filepath.Join(filepath.Dir(full), name), "file")
		if err != nil {
			return err
		}
		if target != full && fileExists(target) {
			return httpx.Conflict(name+" already exists", nil)
		}
		content, _, err := readTextFile(full)
		if err != nil {
			return err
		}
		if target != full {
			s.expectDelete(full)
		}
		modifiedAt, err := writeSQLFile(target, content)
		if err != nil {
			return err
		}
		s.expectWrite(target, modifiedAt)
		if target != full {
			os.Remove(full)
		}
		entry, err := entryFor(target)
		if err != nil {
			return err
		}
		return httpx.JSON(w, entry)
	})

	s.handle("DELETE /api/files", func(w http.ResponseWriter, r *http.Request) error {
		full, err := s.SafePath(r.URL.Query().Get("path"), "file")
		if err != nil {
			return err
		}
		s.expectDelete(full)
		os.Remove(full)
		return httpx.JSON(w, map[string]any{"ok": true})
	})
}

func (s *Server) expectWrite(path, modifiedAt string) {
	if s.watcher != nil {
		s.watcher.ExpectWrite(path, modifiedAt)
	}
}

func (s *Server) expectDelete(path string) {
	if s.watcher != nil {
		s.watcher.ExpectDelete(path)
	}
}
