package server

import (
	"context"
	"strings"
	"sync"
	"time"

	"perch/db"
	"perch/httpx"
	"perch/protocol"
	"perch/storage"
)

type StartRunInput struct {
	ConnectionID string
	SQL          string
	Database     string
	RunID        string
	MaxRows      *int
	BatchSize    *int
	TimeoutMs    *int
	// Record false keeps the run out of history.jsonl and off the event bus, so a probe never
	// shows up in History. The run log still remembers it, so cancel and export keep working.
	Record   *bool
	ReadOnly bool
	Source   protocol.RunSource
}

// Runner runs SQL on behalf of a client: it builds the RunRecord, forwards every driver event to
// the caller while accumulating the same events into that record, guarantees exactly one done,
// and appends the run to the on-disk history when it ends.
type Runner struct {
	pool *Pool
	log  *RunLog

	mu sync.Mutex
	// Runs currently executing, so a cancel knows which driver to ask.
	running   map[string]db.Driver
	listeners []func(protocol.RunRecord)
}

func NewRunner(pool *Pool, log *RunLog) *Runner {
	return &Runner{pool: pool, log: log, running: map[string]db.Driver{}}
}

func (r *Runner) OnFinished(fn func(protocol.RunRecord)) {
	r.mu.Lock()
	r.listeners = append(r.listeners, fn)
	r.mu.Unlock()
}

// StartRun executes the SQL, forwarding every driver event to emit as it happens while
// accumulating the same events into a RunRecord kept in the run log. It does not fail for SQL
// errors: those arrive as error events.
func (r *Runner) StartRun(ctx context.Context, input StartRunInput, emit func(protocol.RunEvent)) (protocol.RunRecord, error) {
	if emit == nil {
		emit = func(protocol.RunEvent) {}
	}
	if strings.TrimSpace(input.SQL) == "" {
		return protocol.RunRecord{}, httpx.BadRequest("sql is required")
	}
	config, err := r.pool.Config(input.ConnectionID)
	if err != nil {
		return protocol.RunRecord{}, err
	}
	settings, err := storage.GetSettings()
	if err != nil {
		return protocol.RunRecord{}, err
	}

	runID := input.RunID
	if runID == "" {
		runID = storage.NewID()
	}
	r.mu.Lock()
	_, busy := r.running[runID]
	r.mu.Unlock()
	if busy {
		return protocol.RunRecord{}, httpx.Conflict("run "+runID+" is already executing", nil)
	}

	database := input.Database
	if database == "" {
		database = config.Database
	}
	startedAt := time.Now()
	record := &protocol.RunRecord{
		ID:           runID,
		ConnectionID: config.ID,
		Database:     database,
		SQL:          input.SQL,
		Status:       protocol.RunRunning,
		StartedAt:    protocol.ISOTime(startedAt),
		Results:      []protocol.StatementResult{},
		Source:       input.Source,
	}
	r.log.Remember(record)

	driver, err := r.pool.DriverFor(ctx, config.ID)
	if err != nil {
		return *record, err
	}
	r.mu.Lock()
	r.running[runID] = driver
	r.mu.Unlock()

	opts := protocol.QueryOptions{
		RunID:     runID,
		Database:  input.Database,
		MaxRows:   settings.MaxRows,
		BatchSize: 200,
		TimeoutMs: settings.StatementTimeout,
		Record:    input.Record,
		ReadOnly:  input.ReadOnly,
	}
	if input.MaxRows != nil {
		opts.MaxRows = *input.MaxRows
	}
	if input.BatchSize != nil {
		opts.BatchSize = *input.BatchSize
	}
	if input.TimeoutMs != nil {
		opts.TimeoutMs = *input.TimeoutMs
	}

	capture := newCapture(record, emit)
	status := driver.Run(ctx, input.SQL, opts, capture.emit)

	r.mu.Lock()
	delete(r.running, runID)
	r.mu.Unlock()

	duration := time.Since(startedAt).Milliseconds()
	record.Status = status
	record.DurationMs = &duration
	record.FinishedAt = protocol.Now()
	// Guarantees the NDJSON stream always ends with exactly one done line.
	if !capture.sawDone {
		emit(protocol.NewRunDone(runID, status, duration))
	}

	// A probe run is neither written to history nor announced on the event bus.
	if input.Record != nil && !*input.Record {
		return *record, nil
	}
	// History is best-effort: never fail a run because the log could not be written.
	_ = storage.AppendHistory(*record)

	r.mu.Lock()
	listeners := append([]func(protocol.RunRecord){}, r.listeners...)
	r.mu.Unlock()
	for _, listener := range listeners {
		listener(*record)
	}
	return *record, nil
}

func (r *Runner) CancelRun(runID string) bool {
	r.mu.Lock()
	driver, ok := r.running[runID]
	r.mu.Unlock()
	if !ok {
		return false
	}
	return driver.Cancel(runID)
}

// capture grows the record as events stream past. A driver may emit a statement's rows only as
// rows events and leave them out of its result, so they are buffered per statement index and
// folded back in.
type capture struct {
	record  *protocol.RunRecord
	emitOut func(protocol.RunEvent)
	buffers map[int][]protocol.Row
	sawDone bool
}

func newCapture(record *protocol.RunRecord, emit func(protocol.RunEvent)) *capture {
	return &capture{record: record, emitOut: emit, buffers: map[int][]protocol.Row{}}
}

func (c *capture) emit(event protocol.RunEvent) {
	switch e := event.(type) {
	case protocol.RunRows:
		c.buffers[e.Index] = append(c.buffers[e.Index], e.Rows...)
	case protocol.RunResult:
		result := e.Result
		if len(result.Rows) == 0 && len(c.buffers[result.Index]) > 0 {
			result.Rows = c.buffers[result.Index]
		}
		delete(c.buffers, result.Index)
		c.record.Results = append(c.record.Results, result)
	case protocol.RunErrorEvent:
		err := e.Error
		c.record.Error = &err
	case protocol.RunDoneEvent:
		c.sawDone = true
	}
	c.emitOut(event)
}
