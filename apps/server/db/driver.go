// Package db is the database half of the server: the driver contract, the pooled connections
// behind it, and the run loop that turns a SQL script into a stream of RunEvents.
package db

import (
	"context"
	"errors"
	"sync"
	"time"

	"perch/protocol"
	"perch/sqlscript"
)

// Driver is the contract every dialect implements. Server-internal: nothing here crosses the
// wire, so it lives beside the drivers rather than in protocol.
type Driver interface {
	Dialect() protocol.Dialect
	Connect(ctx context.Context) error
	Disconnect() error
	IsConnected() bool
	// Test is a cheap round trip; the error carries a readable message on failure.
	Test(ctx context.Context) (serverVersion string, latencyMs int64, err error)
	ListDatabases(ctx context.Context) ([]string, error)
	GetSchema(ctx context.Context, database string) (protocol.DatabaseSchema, error)
	// Run executes sql (which may hold several statements), emitting events in order. It never
	// fails for SQL errors: those are reported as error events and reflected in the status.
	Run(ctx context.Context, sql string, opts protocol.QueryOptions, emit func(protocol.RunEvent)) protocol.RunStatus
	// Cancel stops the run with that id if it is executing here.
	Cancel(runID string) bool
}

// RunOptions is QueryOptions with every default filled in, so no dialect repeats the coercions.
type RunOptions struct {
	RunID string
	// Database is set when the run is aimed at a database other than the one the connection was
	// configured with — the topbar's picker. Dropping it is what made picking a database change
	// the schema tree and nothing else.
	Database  string
	MaxRows   int
	BatchSize int
	Timeout   time.Duration
	// ReadOnly is applied per statement, on that statement's own pooled connection, never once
	// per run.
	ReadOnly bool
}

func NormalizeRunOptions(opts protocol.QueryOptions) RunOptions {
	out := RunOptions{
		RunID:     opts.RunID,
		Database:  opts.Database,
		MaxRows:   1000,
		BatchSize: 200,
		ReadOnly:  opts.ReadOnly,
	}
	if opts.MaxRows != 0 {
		out.MaxRows = max(0, opts.MaxRows)
	}
	if opts.BatchSize != 0 {
		out.BatchSize = max(1, opts.BatchSize)
	}
	if opts.TimeoutMs > 0 {
		out.Timeout = time.Duration(opts.TimeoutMs) * time.Millisecond
	}
	return out
}

// ErrCancelled is returned by StatementContext.CheckCancelled when the run was cancelled before
// the statement ran.
var ErrCancelled = errors.New("run cancelled")

// StatementContext is what a dialect gets for the statement it is executing.
type StatementContext struct {
	Sink    *Sink
	Options RunOptions
	Index   int

	entry *runEntry
}

// SetHandle remembers what Cancel would have to kill: a Postgres backend pid, a MySQL thread id.
func (c *StatementContext) SetHandle(handle any) {
	c.entry.mu.Lock()
	c.entry.handle = handle
	c.entry.mu.Unlock()
}

func (c *StatementContext) IsCancelled() bool {
	c.entry.mu.Lock()
	defer c.entry.mu.Unlock()
	return c.entry.cancelled
}

// CheckCancelled abandons the statement when a cancel arrived while we were getting ready.
func (c *StatementContext) CheckCancelled() error {
	if c.IsCancelled() {
		return ErrCancelled
	}
	return nil
}

type runEntry struct {
	mu        sync.Mutex
	handle    any
	cancelled bool
}

// base is the half of a driver that has nothing to do with a dialect: the run loop (one start,
// one statement per statement, one done), the cancellation flag, and the bookkeeping around each
// statement. A dialect fills in the hooks.
type base struct {
	config protocol.ConnectionConfig

	mu   sync.Mutex
	runs map[string]*runEntry

	execStatement  func(ctx context.Context, sql string, sc *StatementContext) error
	killHandle     func(handle any) error
	isCancellation func(err error, requested bool) bool
	toQueryError   func(err error, sql string) protocol.QueryError
}

func newBase(config protocol.ConnectionConfig) base {
	return base{config: config, runs: map[string]*runEntry{}}
}

func (b *base) run(ctx context.Context, sql string, opts protocol.QueryOptions, emit func(protocol.RunEvent)) protocol.RunStatus {
	options := NormalizeRunOptions(opts)
	statements := sqlscript.Split(sql)
	startedAt := time.Now()

	entry := &runEntry{}
	b.mu.Lock()
	b.runs[options.RunID] = entry
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.runs, options.RunID)
		b.mu.Unlock()
	}()

	emit(protocol.NewRunStart(options.RunID, len(statements)))
	status := protocol.RunDone

	for index, statement := range statements {
		entry.mu.Lock()
		cancelled := entry.cancelled
		entry.mu.Unlock()
		if cancelled {
			status = protocol.RunCancelled
			break
		}
		emit(protocol.NewRunStatement(options.RunID, index, statement.SQL))
		outcome := b.runStatement(ctx, entry, statement.SQL, index, options, emit)
		if outcome != protocol.RunDone {
			status = outcome
			break
		}
	}

	emit(protocol.NewRunDone(options.RunID, status, time.Since(startedAt).Milliseconds()))
	return status
}

func (b *base) runStatement(ctx context.Context, entry *runEntry, sql string, index int, options RunOptions, emit func(protocol.RunEvent)) protocol.RunStatus {
	sink := NewSink(options.RunID, index, sql, options.MaxRows, options.BatchSize, emit)
	sc := &StatementContext{Sink: sink, Options: options, Index: index, entry: entry}

	err := b.execStatement(ctx, sql, sc)

	entry.mu.Lock()
	requested := entry.cancelled
	entry.handle = nil
	entry.mu.Unlock()

	if err != nil {
		if errors.Is(err, ErrCancelled) || b.isCancellation(err, requested) {
			return protocol.RunCancelled
		}
		emit(protocol.NewRunError(options.RunID, index, b.toQueryError(err, sql)))
		return protocol.RunError
	}
	sink.Finish()
	return protocol.RunDone
}

func (b *base) cancel(runID string, connected bool) bool {
	b.mu.Lock()
	entry, ok := b.runs[runID]
	b.mu.Unlock()
	if !ok {
		return false
	}
	entry.mu.Lock()
	entry.cancelled = true
	handle := entry.handle
	entry.mu.Unlock()

	if handle == nil || !connected {
		return true
	}
	// The statement may have finished on its own; the flag already marks the run cancelled.
	_ = b.killHandle(handle)
	return true
}

func (b *base) clearRuns() {
	b.mu.Lock()
	b.runs = map[string]*runEntry{}
	b.mu.Unlock()
}
