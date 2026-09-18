package server

import (
	"net/http"
	"time"

	"perch/httpx"
	"perch/protocol"
)

// One long-lived SSE stream per UI, carrying file changes, finished runs and root changes.
func (s *Server) registerEvents() {
	s.handle("GET /api/events", func(w http.ResponseWriter, r *http.Request) error {
		sse := httpx.NewSSE(w)
		sub := s.bus.Subscribe()
		defer s.bus.Unsubscribe(sub)

		if err := sse.Send(protocol.NewHello(s.startedAt)); err != nil {
			return nil
		}
		roots, err := s.WorkspaceRoots()
		if err != nil {
			roots = []string{}
		}
		if err := sse.Send(protocol.NewRootsEvent(roots)); err != nil {
			return nil
		}

		ping := time.NewTicker(httpx.SSEPingInterval)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return nil
			case event, ok := <-sub:
				if !ok {
					return nil // server shutting down
				}
				if sse.Send(event) != nil {
					return nil
				}
			case <-ping.C:
				if sse.Ping() != nil {
					return nil
				}
			}
		}
	})
}
