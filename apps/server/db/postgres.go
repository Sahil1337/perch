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

// The connection's own pool. A statement holds one connection at a time; four covers concurrent
// runs. A database other than the connection's own is a side trip, so it gets a smaller pool.
const (
	mainPoolMax      = 4
	secondaryPoolMax = 2
)

type postgresDriver struct {
	base

	mu    sync.Mutex
	pool  *pgxpool.Pool
	extra map[string]*pgxpool.Pool

	sources *columnSourceCache
	// Notices arrive on the connection, not the query, so the sink currently reading that
	// connection is looked up when one fires.
	noticeSinks sync.Map // *pgconn.PgConn -> *Sink
}

func newPostgresDriver(config protocol.ConnectionConfig) *postgresDriver {
	d := &postgresDriver{
		base:    newBase(config),
		extra:   map[string]*pgxpool.Pool{},
		sources: newColumnSourceCache(),
	}
	d.execStatement = d.exec
	d.killHandle = d.kill
	d.isCancellation = pgIsCancellation
	d.toQueryError = pgQueryError
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

func (d *postgresDriver) Run(ctx context.Context, sql string, opts protocol.QueryOptions, emit func(protocol.RunEvent)) protocol.RunStatus {
	if _, err := d.requirePool(ctx); err != nil {
		emit(protocol.NewRunStart(opts.RunID, 0))
		emit(protocol.NewRunError(opts.RunID, 0, protocol.QueryError{Message: err.Error()}))
		emit(protocol.NewRunDone(opts.RunID, protocol.RunError, 0))
		return protocol.RunError
	}
	return d.run(ctx, sql, opts, emit)
}

func (d *postgresDriver) Cancel(runID string) bool {
	return d.cancel(runID, d.IsConnected())
}

func (d *postgresDriver) exec(ctx context.Context, sql string, sc *StatementContext) error {
	pool, err := d.poolFor(ctx, sc.Options.Database)
	if err != nil {
		return err
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	pgConn := conn.Conn().PgConn()
	d.noticeSinks.Store(pgConn, sc.Sink)
	defer d.noticeSinks.Delete(pgConn)

	// The backend pid is what a cancel has to kill; pgx already knows it, so no round trip.
	sc.SetHandle(int32(pgConn.PID()))
	if err := sc.CheckCancelled(); err != nil {
		return err
	}

	// Per statement, not per run: the next statement gets another pooled connection.
	if sc.Options.Timeout > 0 {
		ms := strconv.FormatInt(sc.Options.Timeout.Milliseconds(), 10)
		if _, err := conn.Exec(ctx, "set statement_timeout = "+ms); err != nil {
			return err
		}
		defer conn.Exec(ctx, "set statement_timeout = default")
	}
	if sc.Options.ReadOnly {
		if _, err := conn.Exec(ctx, "set default_transaction_read_only = on"); err != nil {
			return err
		}
		defer conn.Exec(ctx, "set default_transaction_read_only = default")
	}

	database := sc.Options.Database
	if database == "" {
		database = d.config.Database
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

func (d *postgresDriver) kill(handle any) error {
	pid, ok := handle.(int32)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := d.requirePool(ctx)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, "select pg_cancel_backend($1)", pid)
	return err
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
