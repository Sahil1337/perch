package httpx

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"perch/protocol"
)

// Proxies and browsers drop a stream that says nothing.
const SSEPingInterval = 25 * time.Second

// SSE frames server events. One goroutine owns it — the route's own loop — so nothing here
// needs a lock.
type SSE struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

func NewSSE(w http.ResponseWriter) *SSE {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	s := &SSE{w: w, rc: http.NewResponseController(w)}
	_ = s.rc.Flush()
	return s
}

func (s *SSE) Send(event protocol.ServerEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event.EventType(), data); err != nil {
		return err
	}
	return s.rc.Flush()
}

func (s *SSE) Ping() error {
	if _, err := s.w.Write([]byte(": ping\n\n")); err != nil {
		return err
	}
	return s.rc.Flush()
}

// NDJSON writes one JSON value per line, flushed in order.
type NDJSON struct {
	w  http.ResponseWriter
	rc *http.ResponseController
}

func NewNDJSON(w http.ResponseWriter) *NDJSON {
	h := w.Header()
	h.Set("Content-Type", "application/x-ndjson; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	n := &NDJSON{w: w, rc: http.NewResponseController(w)}
	_ = n.rc.Flush()
	return n
}

func (n *NDJSON) Write(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := n.w.Write(append(data, '\n')); err != nil {
		return err
	}
	return n.rc.Flush()
}
