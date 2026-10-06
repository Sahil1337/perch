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
	// fails for SQL errors: those are reported as error events and reflected in the status. The
	// state is what the run's session key holds afterwards; nil without a key.
	Run(ctx context.Context, sql string, opts protocol.QueryOptions, emit func(protocol.RunEvent)) (protocol.RunStatus, *protocol.TransactionState)
	// Cancel stops the run with that id if it is executing here.
	Cancel(runID string) bool
}

// SessionHolder is a driver that keeps a keyed run's open transaction, and its connection, for the
// key's next run. Only Postgres is one.
type SessionHolder interface {
	// Release rolls back and frees whatever the key holds, on any database, and reports how many
	// transactions that was. A key that holds nothing is not an error.
	Release(sessionKey string) int
	// OnClosed is told when a held transaction ends without a run ending it. Set it before the
	// driver runs anything.
	OnClosed(fn func(database, sessionKey string, reason protocol.TransactionReason))
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
	// per run — which is why a read-only run gets no session. Sharing one connection across the
	// script would let a statement such as `BEGIN READ WRITE` or
	// `SET default_transaction_read_only = off` lift the setting for the statements after it.
	ReadOnly bool
	// SessionKey names the editor tab a run comes from. Never set on a read-only run, which has no
	// session to keep.
	SessionKey string
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
	if !opts.ReadOnly {
		out.SessionKey = opts.SessionKey
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
	// Session is what the dialect's openSession returned for this run. Nil when the run has none —
	// a read-only run, or a dialect without sessions — and the statement acquires its own
	// connection.
	Session any

	entry *runEntry
}

// SetHandle remembers what Cancel would have to kill: a Postgres connection, a MySQL thread id.
func (c *StatementContext) SetHandle(handle any) {
	c.entry.mu.Lock()
	c.entry.handle = handle
	c.entry.mu.Unlock()
}

// ClearHandle forgets the handle once the statement is over, and waits out a kill already sent
// for it, so a late cancel cannot land on whatever the connection runs next.
func (c *StatementContext) ClearHandle() { c.entry.clearHandle() }

// WaitContext is for waiting on a pool, never for running a statement: Cancel ends it, whereas a
// statement's own context being cancelled makes pgx close the connection under it.
func (c *StatementContext) WaitContext() context.Context { return c.entry.wait }

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
	// Kills sent for the handle that is set; clearHandle waits them out.
	kills sync.WaitGroup
	// wait is cancelled by Cancel, to abandon a wait for a pooled connection.
	wait context.Context
	stop context.CancelFunc
}

func (e *runEntry) clearHandle() {
	e.mu.Lock()
	e.handle = nil
	e.mu.Unlock()
	e.kills.Wait()
}

// How long closeSession gets to hand a run's connection back, whatever became of the run.
const sessionCloseTimeout = 5 * time.Second

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
	// Optional. With both set, a run that can write holds one connection from its first statement
	// to its last, so a transaction, a cursor or a SET carries across its statements. closeSession
	// always runs, however the run ended, and says what the run's key holds afterwards. Both speak
	// to the run as a whole through notice: a transaction rolled back, or one still open.
	openSession  func(ctx context.Context, opts RunOptions, notice func(string)) (any, error)
	closeSession func(ctx context.Context, session any, notice func(string)) *protocol.TransactionState
	// What a key holds, for a keyed run that never got its session: turned away as busy, or with
	// no statement to run.
	keyState func(opts RunOptions) *protocol.TransactionState
}

func newBase(config protocol.ConnectionConfig) base {
	return base{config: config, runs: map[string]*runEntry{}}
}

func (b *base) run(ctx context.Context, sql string, opts protocol.QueryOptions, emit func(protocol.RunEvent)) (protocol.RunStatus, *protocol.TransactionState) {
	options := NormalizeRunOptions(opts)
	statements := sqlscript.Split(sql)
	startedAt := time.Now()

	entry := &runEntry{}
	entry.wait, entry.stop = context.WithCancel(ctx)
	defer entry.stop()
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
	pinned := !options.ReadOnly && b.openSession != nil && b.closeSession != nil
	var session any
	notice := func(message string) { emit(protocol.NewRunNotice(options.RunID, -1, message)) }

	for index, statement := range statements {
		entry.mu.Lock()
		cancelled := entry.cancelled
		entry.mu.Unlock()
		if cancelled {
			status = protocol.RunCancelled
			break
		}
		emit(protocol.NewRunStatement(options.RunID, index, statement.SQL))
		if pinned && session == nil {
			opened, err := b.openSession(entry.wait, options, notice)
			if err != nil {
				status = b.failure(err, entry, index, statement.SQL, options, emit)
				break
			}
			session = opened
		}
		outcome := b.runStatement(ctx, entry, session, statement.SQL, index, options, emit)
		if outcome != protocol.RunDone {
			status = outcome
			break
		}
	}

	var transaction *protocol.TransactionState
	if session != nil {
		// Not the run's context: a run whose client went away still has to give its connection
		// back clean.
		closeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), sessionCloseTimeout)
		transaction = b.closeSession(closeCtx, session, notice)
		cancel()
	} else if pinned && options.SessionKey != "" && b.keyState != nil {
		transaction = b.keyState(options)
	}

	emit(protocol.NewRunDone(options.RunID, status, time.Since(startedAt).Milliseconds()))
	return status, transaction
}

func (b *base) runStatement(ctx context.Context, entry *runEntry, session any, sql string, index int, options RunOptions, emit func(protocol.RunEvent)) protocol.RunStatus {
	sink := NewSink(options.RunID, index, sql, options.MaxRows, options.BatchSize, emit)
	sc := &StatementContext{Sink: sink, Options: options, Index: index, Session: session, entry: entry}

	err := b.execStatement(ctx, sql, sc)
	entry.clearHandle()

	if err != nil {
		return b.failure(err, entry, index, sql, options, emit)
	}
	sink.Finish()
	return protocol.RunDone
}

// failure is the run's status after a statement failed: cancelled when the error is the cancel
// that was asked for, otherwise an error, announced as the statement's error event.
func (b *base) failure(err error, entry *runEntry, index int, sql string, options RunOptions, emit func(protocol.RunEvent)) protocol.RunStatus {
	entry.mu.Lock()
	requested := entry.cancelled
	entry.mu.Unlock()

	if errors.Is(err, ErrCancelled) || (requested && errors.Is(err, context.Canceled)) || b.isCancellation(err, requested) {
		return protocol.RunCancelled
	}
	emit(protocol.NewRunError(options.RunID, index, b.toQueryError(err, sql)))
	return protocol.RunError
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
	kill := handle != nil && connected
	if kill {
		entry.kills.Add(1)
	}
	entry.mu.Unlock()
	entry.stop()

	if !kill {
		return true
	}
	defer entry.kills.Done()
	// The statement may have finished on its own; the flag already marks the run cancelled.
	_ = b.killHandle(handle)
	return true
}

func (b *base) clearRuns() {
	b.mu.Lock()
	b.runs = map[string]*runEntry{}
	b.mu.Unlock()
}
