package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"perch/httpx"
	"perch/protocol"
	"perch/storage"
)

// How hard we chase a cancel for a client that disconnected mid-run.
const (
	cancelAttempts = 40
	cancelRetry    = 25 * time.Millisecond
)

type queryBody struct {
	ConnectionID string  `json:"connectionId"`
	SQL          string  `json:"sql"`
	Database     string  `json:"database"`
	RunID        string  `json:"runId"`
	MaxRows      *int    `json:"maxRows"`
	TimeoutMs    *int    `json:"timeoutMs"`
	BatchSize    *int    `json:"batchSize"`
	Record       *bool   `json:"record"`
	ReadOnly     *bool   `json:"readOnly"`
	Source       *string `json:"source"`
}

func (s *Server) runInputFrom(r *http.Request) (StartRunInput, error) {
	var body queryBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return StartRunInput{}, err
	}
	if body.ConnectionID == "" {
		return StartRunInput{}, httpx.BadRequest("connectionId is required")
	}
	if strings.TrimSpace(body.SQL) == "" {
		return StartRunInput{}, httpx.BadRequest("sql is required")
	}
	// Surfaces an unknown connection as a 404 before we commit to a streaming response.
	config, err := s.pool.Config(body.ConnectionID)
	if err != nil {
		return StartRunInput{}, err
	}

	runID := body.RunID
	if runID == "" {
		runID = storage.NewID()
	}
	source := protocol.SourceUI
	if body.Source != nil && *body.Source == "cli" {
		source = protocol.SourceCLI
	}
	input := StartRunInput{
		ConnectionID: config.ID,
		SQL:          body.SQL,
		Database:     body.Database,
		RunID:        runID,
		MaxRows:      body.MaxRows,
		TimeoutMs:    body.TimeoutMs,
		BatchSize:    body.BatchSize,
		Record:       body.Record,
		Source:       source,
	}
	if body.ReadOnly != nil {
		input.ReadOnly = *body.ReadOnly
	}
	return input, nil
}

func (s *Server) registerQuery() {
	s.handle("POST /api/query", func(w http.ResponseWriter, r *http.Request) error {
		input, err := s.runInputFrom(r)
		if err != nil {
			return err
		}
		out := httpx.NewNDJSON(w)
		finished := make(chan struct{})
		// The client going away must cancel the run rather than abort it mid-statement, so the
		// run gets a context of its own and the cancel travels the same path the API's own
		// /runs/:id/cancel takes.
		go s.chaseCancel(r.Context(), input.RunID, finished)

		emit := func(event protocol.RunEvent) { _ = out.Write(event) }
		_, runErr := s.runner.StartRun(context.WithoutCancel(r.Context()), input, emit)
		close(finished)
		if runErr != nil {
			emit(protocol.NewRunError(input.RunID, 0, protocol.QueryError{Message: runErr.Error()}))
			emit(protocol.NewRunDone(input.RunID, protocol.RunError, 0))
		}
		return nil
	})

	s.handle("POST /api/query/sync", func(w http.ResponseWriter, r *http.Request) error {
		input, err := s.runInputFrom(r)
		if err != nil {
			return err
		}
		record, err := s.runner.StartRun(r.Context(), input, nil)
		if err != nil {
			return err
		}
		return httpx.JSON(w, record)
	})
}

// The run may not have reached the driver yet when the client disconnects, so keep asking until
// the cancel lands or the run ends on its own.
func (s *Server) chaseCancel(ctx context.Context, runID string, finished <-chan struct{}) {
	select {
	case <-finished:
		return
	case <-ctx.Done():
	}
	for attempt := 0; attempt < cancelAttempts; attempt++ {
		select {
		case <-finished:
			return
		default:
		}
		if s.runner.CancelRun(runID) {
			return
		}
		time.Sleep(cancelRetry)
	}
}
