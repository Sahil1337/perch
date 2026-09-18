package server

import (
	"net/http"
	"os"

	"perch/httpx"
)

// The one public route, and what `perch status` polls to decide whether the server in
// server.json is still alive.
func (s *Server) registerHealth() {
	s.handle("GET /api/health", func(w http.ResponseWriter, r *http.Request) error {
		info := s.ServerInfo(os.Getpid())
		if info.URL == "" {
			info.URL = requestOrigin(r)
		}
		return httpx.JSON(w, info)
	})
}

func requestOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
