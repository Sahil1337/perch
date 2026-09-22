// Package server is the HTTP API. This file owns the wiring only — middleware order, the shared
// state routes close over, and the lifetimes that outlive a request. Routes live one file each.
package server

import (
	"net/http"
	"strings"

	"perch/discover"
	"perch/httpx"
	"perch/protocol"
	"perch/storage"
	"perch/watch"
)

type Options struct {
	Version string
	// UIDir holds the built UI. Empty falls back to the embedded bundle, then to a short notice.
	UIDir string
	// URL is reported by /api/health.
	URL       string
	StartedAt string
	// Watch runs the filesystem watcher. Default true.
	Watch bool
	// AllowOrigins lets a UI dev server on another origin call /api/*. Production is same-origin.
	AllowOrigins []string
}

type Server struct {
	version      string
	uiDir        string
	url          string
	startedAt    string
	allowOrigins []string

	bus       *Bus
	pool      *Pool
	runLog    *RunLog
	runner    *Runner
	discovery *discover.Service
	watcher   *watch.Watcher

	mux *http.ServeMux
}

func New(opts Options) *Server {
	startedAt := opts.StartedAt
	if startedAt == "" {
		startedAt = protocol.Now()
	}

	s := &Server{
		version:      opts.Version,
		uiDir:        opts.UIDir,
		url:          opts.URL,
		startedAt:    startedAt,
		allowOrigins: opts.AllowOrigins,
		bus:          NewBus(),
		pool:         NewPool(),
		runLog:       NewRunLog(),
		discovery:    discover.New(),
		mux:          http.NewServeMux(),
	}
	s.runner = NewRunner(s.pool, s.runLog)

	// A finished run is interesting to every connected UI, not just the one that started it.
	s.runner.OnFinished(func(record protocol.RunRecord) {
		s.bus.Publish(protocol.NewRunServerEvent(record.ID, record.Status))
	})

	if opts.Watch {
		s.watcher = watch.New(func(event protocol.FileEvent) {
			s.bus.Publish(protocol.NewFileServerEvent(event))
		})
		if roots, err := s.WorkspaceRoots(); err == nil {
			s.watcher.SetRoots(roots)
		}
	}

	s.routes()
	return s
}

func (s *Server) routes() {
	s.registerHealth()
	s.registerBrowse()
	s.registerEvents()
	s.registerConnections()
	s.registerDiscover()
	s.registerSchema()
	s.registerQuery()
	s.registerRuns()
	s.registerHistory()
	s.registerSettings()
	s.registerFiles()
	// Last: the UI mount ends in a catch-all.
	s.registerUI()
}

func (s *Server) handle(pattern string, h httpx.Handler) {
	s.mux.Handle(pattern, httpx.Wrap(h))
}

func (s *Server) Handler() http.Handler {
	return s.cors(s.mux)
}

// Plain CORS, no credentials: only what a UI dev server on its own port needs.
func (s *Server) cors(next http.Handler) http.Handler {
	if len(s.allowOrigins) == 0 {
		return next
	}
	allowed := make(map[string]bool, len(s.allowOrigins))
	for _, o := range s.allowOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowed[origin] && strings.HasPrefix(r.URL.Path, "/api/") {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Close ends everything that outlives a request.
func (s *Server) Close() {
	if s.watcher != nil {
		s.watcher.Close()
	}
	s.bus.CloseAll()
	s.pool.Shutdown()
	// bbolt holds a file lock on history.db; a process that exits without releasing it makes the
	// next `perch serve` wait two seconds for nothing.
	_ = storage.CloseHistory()
}

func (s *Server) ServerInfo(pid int) protocol.ServerInfo {
	return protocol.ServerInfo{
		Name:       "perch",
		Version:    s.version,
		PID:        pid,
		URL:        s.url,
		StartedAt:  s.startedAt,
		ConfigDir:  storage.ConfigDir(),
		QueriesDir: storage.DefaultQueriesDir(),
	}
}
