package db

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"perch/protocol"
)

// The connection's own pool. A run that can write holds one connection from its first statement
// to its last, and a tab with a transaction open holds one between runs, so four is how many of
// those there can be at once; the next waits up to acquireTimeout for one to be free. A database
// other than the connection's own is a side trip, so it gets a smaller pool.
const (
	mainPoolMax      = 4
	secondaryPoolMax = 2
	acquireTimeout   = 10 * time.Second
)

// pgSession is the connection a run holds for all of its statements. claim is set for a run with a
// session key, whose transaction may outlive it.
type pgSession struct {
	pool     *pgxpool.Pool
	conn     *pgxpool.Conn
	database string
	claim    *keyedSession
}

type postgresDriver struct {
	base

	mu    sync.Mutex
	pool  *pgxpool.Pool
	extra map[string]*pgxpool.Pool

	sources *columnSourceCache
	// Notices arrive on the connection, not the query, so the sink currently reading that
	// connection is looked up when one fires.
	noticeSinks sync.Map // *pgconn.PgConn -> *Sink

	keysMu sync.Mutex
	// By heldID: what each session key has claimed, and what an idle rollback left to be said.
	keyed      map[string]*keyedSession
	tombstones map[string]string
	onClosed   func(database, sessionKey string, reason protocol.TransactionReason)
}

func newPostgresDriver(config protocol.ConnectionConfig) *postgresDriver {
	d := &postgresDriver{
		base:       newBase(config),
		extra:      map[string]*pgxpool.Pool{},
		sources:    newColumnSourceCache(),
		keyed:      map[string]*keyedSession{},
		tombstones: map[string]string{},
	}
	d.execStatement = d.exec
	d.killHandle = d.kill
	d.isCancellation = pgIsCancellation
	d.toQueryError = pgQueryError
	d.openSession = d.startSession
	d.closeSession = d.endSession
	d.keyState = d.heldState
	return d
}

func (d *postgresDriver) Dialect() protocol.Dialect { return protocol.DialectPostgres }

// quoteDSN makes a value safe to put in a libpq keyword/value connection string.
//
// Unquoted, a space ends the value and the next word is read as another keyword — so a role or
// database named with a space in it does not fail at the server, it fails at the parser, with a
// message about the connection string rather than about the login. Single quotes allow the space
// through; inside them a backslash escapes a quote or another backslash. The password is not
// here for the same reason in reverse: it is the field likeliest to hold anything at all, so it
// is set on the parsed config rather than written into a string that has to be parsed.
func quoteDSN(value string) string {
	return "'" + dsnEscape.Replace(value) + "'"
}

var dsnEscape = strings.NewReplacer(`\`, `\\`, `'`, `\'`)

func (d *postgresDriver) poolConfig(database string, max int32) (*pgxpool.Config, error) {
	if database == "" {
		database = d.config.Database
	}
	appName := "perch"
	if v, ok := d.config.Options["application_name"].(string); ok && v != "" {
		appName = v
	}
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s dbname=%s application_name=%s sslmode=%s connect_timeout=%d",
		quoteDSN(d.config.Host), d.config.Port, quoteDSN(d.config.User), quoteDSN(database),
		quoteDSN(appName), sslModeFor(d.config), int(connectTimeout.Seconds()),
	)
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	cfg.ConnConfig.Password = d.config.Password
	cfg.MaxConns = max
	cfg.ConnConfig.OnNotice = func(conn *pgconn.PgConn, notice *pgconn.Notice) {
		if sink, ok := d.noticeSinks.Load(conn); ok {
			sink.(*Sink).Notice(notice.Message)
		}
	}
	return cfg, nil
}

func (d *postgresDriver) Connect(ctx context.Context) error {
	d.mu.Lock()
	if d.pool != nil {
		d.mu.Unlock()
		return nil
	}
	d.mu.Unlock()

	cfg, err := d.poolConfig("", mainPoolMax)
	if err != nil {
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return err
	}
	// Borrow and return one connection, so Connect fails loudly on an unusable config.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return err
	}
	d.mu.Lock()
	d.pool = pool
	d.mu.Unlock()
	return nil
}

func (d *postgresDriver) Disconnect() error {
	d.mu.Lock()
	pool := d.pool
	extras := d.extra
	d.pool = nil
	d.extra = map[string]*pgxpool.Pool{}
	d.mu.Unlock()

	d.clearRuns()
	d.dropHeld()
	for _, extra := range extras {
		extra.Close()
	}
	if pool != nil {
		pool.Close()
	}
	return nil
}

func (d *postgresDriver) IsConnected() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.pool != nil
}

func (d *postgresDriver) requirePool(ctx context.Context) (*pgxpool.Pool, error) {
	d.mu.Lock()
	pool := d.pool
	d.mu.Unlock()
	if pool != nil {
		return pool, nil
	}
	if err := d.Connect(ctx); err != nil {
		return nil, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.pool == nil {
		return nil, errors.New("not connected")
	}
	return d.pool, nil
}

// poolFor is the pool a statement aimed at database must run on. A pool rather than a
// `set search_path`: in Postgres the database is fixed at connection time, so switching means
// another connection either way, and keeping the pool lets a session hopping between two
// databases stop paying the handshake.
func (d *postgresDriver) poolFor(ctx context.Context, database string) (*pgxpool.Pool, error) {
	if database == "" || database == d.config.Database {
		return d.requirePool(ctx)
	}
	d.mu.Lock()
	if cached, ok := d.extra[database]; ok {
		d.mu.Unlock()
		return cached, nil
	}
	d.mu.Unlock()

	cfg, err := d.poolConfig(database, secondaryPoolMax)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	if cached, ok := d.extra[database]; ok {
		d.mu.Unlock()
		pool.Close()
		return cached, nil
	}
	d.extra[database] = pool
	d.mu.Unlock()
	return pool, nil
}

func (d *postgresDriver) Test(ctx context.Context) (string, int64, error) {
	pool, err := d.requirePool(ctx)
	if err != nil {
		return "", 0, err
	}
	started := time.Now()
	var version string
	if err := pool.QueryRow(ctx, "select version()").Scan(&version); err != nil {
		return "", 0, err
	}
	return version, time.Since(started).Milliseconds(), nil
}

func (d *postgresDriver) ListDatabases(ctx context.Context) ([]string, error) {
	pool, err := d.requirePool(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, "select datname from pg_database where not datistemplate order by 1")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

func (d *postgresDriver) Run(ctx context.Context, sql string, opts protocol.QueryOptions, emit func(protocol.RunEvent)) (protocol.RunStatus, *protocol.TransactionState) {
	if _, err := d.requirePool(ctx); err != nil {
		emit(protocol.NewRunStart(opts.RunID, 0))
		emit(protocol.NewRunError(opts.RunID, 0, protocol.QueryError{Message: err.Error()}))
		emit(protocol.NewRunDone(opts.RunID, protocol.RunError, 0))
		return protocol.RunError, nil
	}
	return d.run(ctx, sql, opts, emit)
}

func (d *postgresDriver) Cancel(runID string) bool {
	return d.cancel(runID, d.IsConnected())
}

func (d *postgresDriver) databaseName(database string) string {
	if database == "" {
		return d.config.Database
	}
	return database
}

// acquire waits for a pooled connection, but not for ever: with every connection held by a long
// run, or by a tab's open transaction, the next run would otherwise hang without a word. wait is
// the run's, so a cancel ends it.
func (d *postgresDriver) acquire(wait context.Context, pool *pgxpool.Pool, database string) (*pgxpool.Conn, error) {
	ctx, cancel := context.WithTimeout(wait, acquireTimeout)
	defer cancel()
	conn, err := pool.Acquire(ctx)
	if err == nil {
		return conn, nil
	}
	if wait.Err() != nil {
		return nil, wait.Err()
	}
	// A slow connect times out here too, and is not the pool being full.
	if stat := pool.Stat(); errors.Is(err, context.DeadlineExceeded) && stat.AcquiredConns() >= stat.MaxConns() {
		return nil, busyError(stat.MaxConns(), database, d.holding(database))
	}
	return nil, err
}

// discard closes a connection instead of returning it to the pool, for when what it holds is
// unknown.
func discard(conn *pgxpool.Conn) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = conn.Hijack().Close(ctx)
}

// startSession lends a run its connection. A run with a session key continues whatever the key
// holds, as it was left: that transaction is the point, so there is no DISCARD.
func (d *postgresDriver) startSession(ctx context.Context, opts RunOptions, notice func(string)) (any, error) {
	database := d.databaseName(opts.Database)
	var claim *keyedSession
	if opts.SessionKey != "" {
		var held *pgSession
		var err error
		claim, held, err = d.claim(ctx, database, opts.SessionKey, notice)
		if err != nil {
			return nil, err
		}
		if held != nil {
			return held, nil
		}
	}

	session, err := func() (*pgSession, error) {
		pool, err := d.poolFor(ctx, opts.Database)
		if err != nil {
			return nil, err
		}
		conn, err := d.acquire(ctx, pool, database)
		if err != nil {
			return nil, err
		}
		// endSession leaves a connection clean, but a read-only run's connection comes back with
		// only its two settings reset, so whatever else it SET would reach this run.
		if err := clean(ctx, conn); err != nil {
			discard(conn)
			return nil, err
		}
		return &pgSession{pool: pool, conn: conn, database: database, claim: claim}, nil
	}()
	if err != nil {
		d.unclaim(claim)
		return nil, err
	}
	return session, nil
}

// endSession ends the run's hold on its connection. A keyed run that stopped inside a transaction
// leaves it held for the key's next run; otherwise the connection goes back to the pool reset.
func (d *postgresDriver) endSession(ctx context.Context, session any, notice func(string)) *protocol.TransactionState {
	s := session.(*pgSession)
	pgConn := s.conn.Conn().PgConn()
	status := pgConn.TxStatus()
	open := status != 'I'

	if pgConn.IsClosed() {
		d.unclaim(s.claim)
		discard(s.conn)
		// The server rolls back what a dropped connection left open.
		if open {
			notice("The connection was lost; any open transaction was rolled back.")
			if s.claim != nil {
				d.closed(s.claim, protocol.ReasonLost)
			}
		}
		return nil
	}
	if open {
		if state, held := d.hold(s, status); held {
			if state == protocol.TransactionFailed {
				notice("The transaction failed. Roll it back to continue.")
			} else {
				notice("The transaction is still open. Commit or roll back to finish it.")
			}
			return &state
		}
	}
	d.unclaim(s.claim)
	if open {
		// Rolled back either way: by reset, or by closing the connection when that fails.
		notice("The transaction was still open when the run ended, so it was rolled back.")
	}
	_ = reset(ctx, s.conn, open)
	return nil
}

// reset gives a connection back to the pool as it was lent: outside any transaction, with no trace
// of the session's SETs, roles, temp tables, cursors, prepared statements or advisory locks. One
// that cannot be put back that way is closed instead, never returned to the pool.
func reset(ctx context.Context, conn *pgxpool.Conn, open bool) error {
	err := func() error {
		if open {
			if _, err := conn.Exec(ctx, "rollback", pgx.QueryExecModeSimpleProtocol); err != nil {
				return err
			}
		}
		// After the rollback: DISCARD refuses to run inside a transaction, and a reset made inside
		// one would be undone with it.
		return clean(ctx, conn)
	}()
	if err != nil {
		discard(conn)
		return err
	}
	conn.Release()
	return nil
}

func clean(ctx context.Context, conn *pgxpool.Conn) error {
	if _, err := conn.Exec(ctx, "discard all", pgx.QueryExecModeSimpleProtocol); err != nil {
		return err
	}
	// DISCARD dropped the server's prepared statements; this drops pgx's memory of them, which a
	// statement a read-only run prepared on this connection would otherwise be sent by name.
	return conn.Conn().DeallocateAll(ctx)
}

func (d *postgresDriver) exec(ctx context.Context, sql string, sc *StatementContext) error {
	if s, ok := sc.Session.(*pgSession); ok {
		// Nothing set here needs undoing afterwards: the whole session is reset on its way back to
		// the pool.
		return d.execOn(ctx, s.pool, s.conn, s.database, sql, sc)
	}

	pool, err := d.poolFor(ctx, sc.Options.Database)
	if err != nil {
		return err
	}
	database := d.databaseName(sc.Options.Database)
	conn, err := d.acquire(sc.WaitContext(), pool, database)
	if err != nil {
		return err
	}
	defer conn.Release()

	// This connection goes back to the pool after one statement, so what it was set to is undone
	// before it does.
	if sc.Options.Timeout > 0 {
		defer conn.Exec(ctx, "set statement_timeout = default")
	}
	if sc.Options.ReadOnly {
		if _, err := conn.Exec(ctx, "set default_transaction_read_only = on"); err != nil {
			return err
		}
		defer conn.Exec(ctx, "set default_transaction_read_only = default")
	}
	return d.execOn(ctx, pool, conn, database, sql, sc)
}

func (d *postgresDriver) execOn(ctx context.Context, pool *pgxpool.Pool, conn *pgxpool.Conn, database, sql string, sc *StatementContext) error {
	pgConn := conn.Conn().PgConn()
	d.noticeSinks.Store(pgConn, sc.Sink)
	defer d.noticeSinks.Delete(pgConn)

	sc.SetHandle(pgConn)
	defer sc.ClearHandle()
	if err := sc.CheckCancelled(); err != nil {
		return err
	}

	// Before every statement, even on a run's own session: a script's `SET statement_timeout = 0`
	// or `RESET ALL` must not switch the run's timeout off for the statements after it. Not in a
	// failed transaction, which refuses everything but a rollback, and the rollback must get through.
	if sc.Options.Timeout > 0 && pgConn.TxStatus() != 'E' {
		ms := strconv.FormatInt(sc.Options.Timeout.Milliseconds(), 10)
		if _, err := conn.Exec(ctx, "set statement_timeout = "+ms); err != nil {
			return err
		}
	}
	return d.readRows(ctx, pool, conn, database, sql, sc.Sink)
}

// readRows streams a statement's rows into the sink. pgx reads the result set message by message
// rather than buffering it, so a large table never lands in memory whole, and closing early is
// what the maxRows cut does. Statements that are not row-returning go through the simple
// protocol, the only one that can run e.g. VACUUM.
func (d *postgresDriver) readRows(ctx context.Context, pool *pgxpool.Pool, conn *pgxpool.Conn, database, sql string, sink *Sink) error {
	args := []any{}
	if !looksRowReturning(sql) {
		args = append(args, pgx.QueryExecModeSimpleProtocol)
	}
	rows, err := conn.Query(ctx, sql, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	if len(fields) > 0 {
		sink.Columns(d.sources.resolve(ctx, pool, database, fields))
	}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return err
		}
		sink.Row(toRow(values))
		if sink.Truncated() {
			break
		}
	}
	if !sink.Truncated() {
		if err := rows.Err(); err != nil {
			return err
		}
	}
	rows.Close()

	tag := rows.CommandTag()
	sink.Command(commandOf(tag))
	// Only when the tag actually carries a count: DDL has none, and reporting 0 would claim the
	// statement affected nothing rather than that the number does not apply.
	if affected, ok := affectedOf(tag); ok && !sink.HasColumns() {
		sink.Affected(affected)
	}
	return nil
}

// affectedOf reads the row count off a command tag ("INSERT 0 2"), reporting false for a tag
// that carries none ("CREATE TABLE").
func affectedOf(tag pgconn.CommandTag) (int64, bool) {
	fields := strings.Fields(tag.String())
	if len(fields) == 0 {
		return 0, false
	}
	count, err := strconv.ParseInt(fields[len(fields)-1], 10, 64)
	if err != nil {
		return 0, false
	}
	return count, true
}

// commandOf is the command tag without its row count: "SELECT 3" -> "SELECT".
func commandOf(tag pgconn.CommandTag) string {
	parts := strings.Fields(tag.String())
	for len(parts) > 0 {
		if _, err := strconv.Atoi(parts[len(parts)-1]); err != nil {
			break
		}
		parts = parts[:len(parts)-1]
	}
	return strings.Join(parts, " ")
}

// kill sends the protocol's own cancel request for the statement's backend. It needs no pooled
// connection, so a full pool cannot starve it, and no pg_signal_backend privilege; and unlike
// cancelling the statement's context, it leaves the connection alive, for endSession to roll back
// or to hold with its transaction failed.
func (d *postgresDriver) kill(handle any) error {
	pgConn, ok := handle.(*pgconn.PgConn)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return pgConn.CancelRequest(ctx)
}

// 57014 is query_canceled; statement timeouts share it, so those stay errors.
func pgIsCancellation(err error, requested bool) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "57014" {
		return false
	}
	if requested {
		return true
	}
	return !strings.Contains(strings.ToLower(pgErr.Message), "statement timeout")
}
