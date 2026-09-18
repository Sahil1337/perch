package server

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	"perch/httpx"
	"perch/webui"
)

// The non-/api surface: the built UI with an SPA fallback.
//
// The bundle reaches us two ways. A directory given with --ui (or one sitting next to the
// binary) is read off disk; otherwise the binary serves what was embedded at build time. A
// directory that exists wins: it is more current than whatever was embedded whenever the binary
// was cut.
func (s *Server) registerUI() {
	var files fs.FS
	if s.uiDir != "" {
		if info, err := os.Stat(s.uiDir); err == nil && info.IsDir() {
			files = os.DirFS(s.uiDir)
		}
	}
	if files == nil {
		if embedded, ok := webui.FS(); ok {
			files = embedded
		}
	}
	if files == nil {
		// No UI shipped with this build: say so plainly rather than render a stand-in page.
		s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				httpx.WriteNotFound(w, r.URL.Path)
				return
			}
			http.Error(w, "perch UI is not built. Run `bun run --filter @perch/web build`, then restart perch.", http.StatusServiceUnavailable)
		})
		return
	}

	assets := http.FileServerFS(files)
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			httpx.WriteNotFound(w, r.URL.Path)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" && name != "." {
			if _, err := fs.Stat(files, name); err == nil {
				assets.ServeHTTP(w, r)
				return
			}
		}
		// SPA fallback: any unmatched non-/api GET renders the shell.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			httpx.WriteNotFound(w, r.URL.Path)
			return
		}
		serveIndex(w, r, files)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, files fs.FS) {
	body, err := fs.ReadFile(files, "index.html")
	if err != nil {
		http.Error(w, "perch UI is missing index.html", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
