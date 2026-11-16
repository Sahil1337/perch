package server

import (
	"net"
	"net/http"

	"perch/httpx"
)

// POST /api/shutdown is how `perch stop` ends a server on every OS, since Go cannot deliver
// SIGTERM on Windows. A browser cannot reach it: it always sends Origin on a cross-site POST,
// and the custom header forces a preflight that cors() never grants for it.
func (s *Server) registerShutdown() {
	if s.onShutdown == nil {
		return
	}
	s.handle("POST /api/shutdown", func(w http.ResponseWriter, r *http.Request) error {
		if !loopbackPeer(r) || len(r.Header.Values("Origin")) > 0 || r.Header.Get("X-Perch-Shutdown") != "1" {
			return httpx.Forbidden("shutdown is only accepted from perch stop on this machine")
		}
		if err := httpx.JSON(w, map[string]bool{"ok": true}, http.StatusAccepted); err != nil {
			return err
		}
		s.onShutdown()
		return nil
	})
}

func loopbackPeer(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
