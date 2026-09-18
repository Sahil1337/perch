package db

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"perch/protocol"
)

type mysqlDriver struct {
	base

	mu        sync.Mutex
	db        *sql.DB
	extra     map[string]*sql.DB
	connected bool
}

func newMysqlDriver(config protocol.ConnectionConfig) *mysqlDriver {
	d := &mysqlDriver{base: newBase(config), extra: map[string]*sql.DB{}}
	d.execStatement = d.exec
	d.killHandle = d.kill
	d.isCancellation = mysqlIsCancellation
	d.toQueryError = mysqlQueryError
	return d
}

func (d *mysqlDriver) Dialect() protocol.Dialect { return protocol.DialectMySQL }

func (d *mysqlDriver) dsn(database string) string {
	if database == "" {
		database = d.config.Database
	}
	cfg := mysqldriver.NewConfig()
	cfg.User = d.config.User
	cfg.Passwd = d.config.Password
	cfg.Net = "tcp"
	cfg.Addr = fmt.Sprintf("%s:%d", d.config.Host, d.config.Port)
	cfg.DBName = database
	// We split statements ourselves, so never let the server run several at once.
	cfg.MultiStatements = false
	// Timestamps arrive as time.Time and leave as ISO strings, matching mysql2's dateStrings:false.
	cfg.ParseTime = true
	if d.config.SSL {
		// The TypeScript driver passed rejectUnauthorized:false.
		cfg.TLSConfig = "skip-verify"
	}
	return cfg.FormatDSN()
}

func (d *mysqlDriver) open(database string, max int) (*sql.DB, error) {
	handle, err := sql.Open("mysql", d.dsn(database))
	if err != nil {
		return nil, err
	}
	handle.SetMaxOpenConns(max)
	handle.SetMaxIdleConns(max)
	return handle, nil
}

func (d *mysqlDriver) Connect(ctx context.Context) error {
	d.mu.Lock()
	if d.db != nil {
		d.mu.Unlock()
		return nil
	}
	d.mu.Unlock()

	handle, err := d.open("", mainPoolMax)
	if err != nil {
		return err
	}
	if err := handle.PingContext(ctx); err != nil {
		handle.Close()
		return err
	}
	d.mu.Lock()
	d.db = handle
	d.connected = true
	d.mu.Unlock()
	return nil
}

func (d *mysqlDriver) Disconnect() error {
	d.mu.Lock()
	handle := d.db
	extras := d.extra
	d.db = nil
	d.extra = map[string]*sql.DB{}
	d.connected = false
	d.mu.Unlock()

	d.clearRuns()
	for _, extra := range extras {
		extra.Close()
	}
	if handle != nil {
		handle.Close()
	}
	return nil
}

func (d *mysqlDriver) IsConnected() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.connected
}

func (d *mysqlDriver) require(ctx context.Context) (*sql.DB, error) {
	d.mu.Lock()
	handle := d.db
	d.mu.Unlock()
	if handle != nil {
		return handle, nil
	}
	if err := d.Connect(ctx); err != nil {
		return nil, err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.db == nil {
		return nil, errors.New("not connected")
	}
	return d.db, nil
}

// dbFor mirrors the Postgres pools: a USE would outlive the statement and quietly redirect
// whatever ran next on that pooled connection, so another database gets its own handle.
func (d *mysqlDriver) dbFor(ctx context.Context, database string) (*sql.DB, error) {
	if database == "" || database == d.config.Database {
		return d.require(ctx)
	}
	d.mu.Lock()
	if cached, ok := d.extra[database]; ok {
		d.mu.Unlock()
		return cached, nil
	}
	d.mu.Unlock()

	handle, err := d.open(database, secondaryPoolMax)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	if cached, ok := d.extra[database]; ok {
		d.mu.Unlock()
		handle.Close()
		return cached, nil
	}
	d.extra[database] = handle
	d.mu.Unlock()
	return handle, nil
}

func (d *mysqlDriver) Test(ctx context.Context) (string, int64, error) {
	handle, err := d.require(ctx)
	if err != nil {
		return "", 0, err
	}
	started := time.Now()
	var version string
	if err := handle.QueryRowContext(ctx, "select version()").Scan(&version); err != nil {
		return "", 0, err
	}
	return version, time.Since(started).Milliseconds(), nil
}

var mysqlHiddenDatabases = map[string]bool{
	"information_schema": true, "performance_schema": true, "mysql": true, "sys": true,
}

func (d *mysqlDriver) ListDatabases(ctx context.Context) ([]string, error) {
	handle, err := d.require(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := handle.QueryContext(ctx, "show databases")
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
		if name != "" && !mysqlHiddenDatabases[strings.ToLower(name)] {
			out = append(out, name)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}

func (d *mysqlDriver) Run(ctx context.Context, sql string, opts protocol.QueryOptions, emit func(protocol.RunEvent)) protocol.RunStatus {
	if _, err := d.require(ctx); err != nil {
		emit(protocol.NewRunStart(opts.RunID, 0))
		emit(protocol.NewRunError(opts.RunID, 0, protocol.QueryError{Message: err.Error()}))
		emit(protocol.NewRunDone(opts.RunID, protocol.RunError, 0))
		return protocol.RunError
	}
	return d.run(ctx, sql, opts, emit)
}

func (d *mysqlDriver) Cancel(runID string) bool {
	return d.cancel(runID, d.IsConnected())
}

func (d *mysqlDriver) exec(ctx context.Context, statement string, sc *StatementContext) error {
	handle, err := d.dbFor(ctx, sc.Options.Database)
	if err != nil {
		return err
	}
	// A pinned connection, so the thread id a cancel kills is the one running the statement.
	conn, err := handle.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	var threadID int64
	if err := conn.QueryRowContext(ctx, "select connection_id()").Scan(&threadID); err != nil {
		return err
	}
	sc.SetHandle(threadID)
	if err := sc.CheckCancelled(); err != nil {
		return err
	}

	// Per statement, like Postgres: the next statement gets another pooled connection.
	if sc.Options.Timeout > 0 {
		// MySQL 5.7.8+ / MariaDB: a server-side cap for SELECTs.
		ms := strconv.FormatInt(sc.Options.Timeout.Milliseconds(), 10)
		_, _ = conn.ExecContext(ctx, "set session max_execution_time = "+ms)
		defer conn.ExecContext(ctx, "set session max_execution_time = 0")
	}
	if sc.Options.ReadOnly {
		if _, err := conn.ExecContext(ctx, "set session transaction_read_only = 1"); err != nil {
			return err
		}
		defer conn.ExecContext(ctx, "set session transaction_read_only = 0")
	}

	if err := d.readInto(ctx, conn, statement, sc.Sink); err != nil {
		return err
	}
	sc.Sink.Command(mysqlCommandOf(statement))
	return nil
}

// MySQL sends no command tag and database/sql exposes affected rows only from Exec, so the
// statement text decides which of the two paths it takes. A wrong guess costs the affected-row
// count or the result set, never correctness of the statement itself.
func (d *mysqlDriver) readInto(ctx context.Context, conn *sql.Conn, statement string, sink *Sink) error {
	if !mysqlRowReturning(statement) {
		result, err := conn.ExecContext(ctx, statement)
		if err != nil {
			return err
		}
		if affected, err := result.RowsAffected(); err == nil {
			sink.Affected(affected)
		}
		return nil
	}

	rows, err := conn.QueryContext(ctx, statement)
	if err != nil {
		return err
	}
	defer rows.Close()

	types, err := rows.ColumnTypes()
	if err != nil {
		return err
	}
	sink.Columns(mysqlResultColumns(types))

	scan := make([]any, len(types))
	holders := make([]any, len(types))
	for i := range scan {
		holders[i] = &scan[i]
	}
	for rows.Next() {
		if err := rows.Scan(holders...); err != nil {
			return err
		}
		row := make(protocol.Row, len(scan))
		for i, value := range scan {
			row[i] = mysqlCell(value, types[i].DatabaseTypeName())
		}
		sink.Row(row)
		if sink.Truncated() {
			return nil
		}
	}
	return rows.Err()
}

func (d *mysqlDriver) kill(handle any) error {
	threadID, ok := handle.(int64)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db, err := d.require(ctx)
	if err != nil {
		return err
	}
	// KILL takes no placeholders; threadID came from the server as an integer.
	_, err = db.ExecContext(ctx, "kill query "+strconv.FormatInt(threadID, 10))
	return err
}

// ER_QUERY_INTERRUPTED (1317) is what KILL QUERY raises in the victim connection;
// max_execution_time expiry (3024) is a timeout error, not a cancellation.
func mysqlIsCancellation(err error, requested bool) bool {
	var myErr *mysqldriver.MySQLError
	if errors.As(err, &myErr) {
		if myErr.Number == 1317 {
			return true
		}
		return requested && myErr.Number != 3024
	}
	return requested
}

var mysqlLinePattern = regexp.MustCompile(`(?i)at line (\d+)`)

func mysqlQueryError(err error, statementSQL string) protocol.QueryError {
	out := protocol.QueryError{Message: err.Error()}
	var myErr *mysqldriver.MySQLError
	if errors.As(err, &myErr) {
		out.Message = myErr.Message
		out.Code = strconv.FormatUint(uint64(myErr.Number), 10)
		if state := strings.TrimSpace(string(myErr.SQLState[:])); state != "" {
			out.Detail = "SQLSTATE " + state
		}
	}
	// MySQL reports no character position, but parse errors carry "... at line N".
	if match := mysqlLinePattern.FindStringSubmatch(out.Message); match != nil {
		if n, convErr := strconv.Atoi(match[1]); convErr == nil && n > 0 {
			offset := offsetOfLine(statementSQL, n)
			out.Line = &n
			out.Position = &offset
		}
	}
	return out
}

func offsetOfLine(sql string, line int) int {
	offset := 0
	for n := 1; n < line; n++ {
		nl := strings.IndexByte(sql[offset:], '\n')
		if nl == -1 {
			return offset
		}
		offset += nl + 1
	}
	return offset
}

func mysqlRowReturning(sql string) bool {
	switch firstWord(sql) {
	case "select", "with", "show", "describe", "desc", "explain", "table", "values", "call":
		return true
	}
	return false
}

var mysqlTwoWordCommands = map[string]bool{
	"create": true, "drop": true, "alter": true, "rename": true, "truncate": true, "show": true,
}

// MySQL has no command tag, so one is derived from the statement text.
func mysqlCommandOf(sql string) string {
	head := stripLeadingNoise(sql)
	words := strings.Fields(head)
	if len(words) == 0 {
		return ""
	}
	first := lettersOnly(words[0])
	if first == "" {
		return ""
	}
	if mysqlTwoWordCommands[first] && len(words) > 1 {
		if second := lettersOnly(words[1]); second != "" {
			return strings.ToUpper(first) + " " + strings.ToUpper(second)
		}
	}
	return strings.ToUpper(first)
}

func lettersOnly(word string) string {
	var b strings.Builder
	for _, r := range word {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
	}
	return strings.ToLower(b.String())
}

var mysqlBinaryTypes = map[string]bool{
	"BLOB": true, "TINYBLOB": true, "MEDIUMBLOB": true, "LONGBLOB": true,
	"BINARY": true, "VARBINARY": true, "GEOMETRY": true,
}

// mysqlCell needs the column type because go-sql-driver hands back []byte for text and numeric
// columns alike; only the genuinely binary ones should become \x hex.
func mysqlCell(value any, dbType string) protocol.Cell {
	if raw, ok := value.([]byte); ok {
		if mysqlBinaryTypes[strings.ToUpper(dbType)] {
			return `\x` + hex.EncodeToString(raw)
		}
		return string(raw)
	}
	return toCell(value)
}

func mysqlResultColumns(types []*sql.ColumnType) []protocol.ResultColumn {
	columns := make([]protocol.ResultColumn, len(types))
	for i, ct := range types {
		name := strings.ToLower(ct.DatabaseTypeName())
		// No Source: the MySQL protocol carries org_table/org_name, but go-sql-driver keeps them
		// unexported and database/sql's ColumnType exposes nothing about a column's origin.
		columns[i] = protocol.ResultColumn{Name: ct.Name(), Type: name, Align: alignFor(name)}
	}
	return columns
}
