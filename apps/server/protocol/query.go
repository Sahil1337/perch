package protocol

type ColumnSource struct {
	Table  string `json:"table"`
	Column string `json:"column"`
}

type ResultColumn struct {
	Name   string        `json:"name"`
	Type   string        `json:"type"`
	Align  Align         `json:"align"`
	Source *ColumnSource `json:"source,omitempty"`
}

type Cell = any

type Row = []Cell

type StatementResult struct {
	Index        int            `json:"index"`
	SQL          string         `json:"sql"`
	Columns      []ResultColumn `json:"columns"`
	Rows         []Row          `json:"rows"`
	RowCount     int            `json:"rowCount"`
	AffectedRows *int64         `json:"affectedRows"`
	Command      *string        `json:"command"`
	DurationMs   int64          `json:"durationMs"`
	Truncated    bool           `json:"truncated"`
	Notices      []string       `json:"notices"`
}

func NewStatementResult(index int, sql string) StatementResult {
	return StatementResult{
		Index:   index,
		SQL:     sql,
		Columns: make([]ResultColumn, 0),
		Rows:    make([]Row, 0),
		Notices: make([]string, 0),
	}
}

type RunStatus string

const (
	RunRunning   RunStatus = "running"
	RunDone      RunStatus = "done"
	RunError     RunStatus = "error"
	RunCancelled RunStatus = "cancelled"
)

type QueryError struct {
	Message  string `json:"message"`
	Code     string `json:"code,omitempty"`
	Position *int   `json:"position,omitempty"`
	Line     *int   `json:"line,omitempty"`
	Detail   string `json:"detail,omitempty"`
	Hint     string `json:"hint,omitempty"`
}

type RunSource string

const (
	SourceUI  RunSource = "ui"
	SourceCLI RunSource = "cli"
)

type RunRecord struct {
	ID           string            `json:"id"`
	ConnectionID string            `json:"connectionId"`
	Database     string            `json:"database"`
	SQL          string            `json:"sql"`
	Status       RunStatus         `json:"status"`
	StartedAt    string            `json:"startedAt"`
	FinishedAt   string            `json:"finishedAt,omitempty"`
	DurationMs   *int64            `json:"durationMs,omitempty"`
	Results      []StatementResult `json:"results,omitempty"`
	Error        *QueryError       `json:"error,omitempty"`
	Source       RunSource         `json:"source"`
	// The workspace root the query came from, when it came from a file in one. Empty means the
	// run belongs to no folder — an untitled buffer, perch's own queries directory, or the CLI —
	// which the History tab calls global.
	Workspace string `json:"workspace,omitempty"`
}

// Which runs a history page is asking for. `workspace` means this root and the global ones, which
// is the view that matches how people work: the project in front of them, plus the scratch queries
// that belong to no project.
type HistoryScope string

const (
	ScopeAll       HistoryScope = "all"
	ScopeWorkspace HistoryScope = "workspace"
	ScopeGlobal    HistoryScope = "global"
)

// A discriminated union on TypeScript's side. The constructors are the only supported way to
// build one: an event with an empty Type is undispatchable at the client.
type RunEvent interface{ EventType() string }

type RunStart struct {
	Type       string `json:"type"`
	RunID      string `json:"runId"`
	Statements int    `json:"statements"`
}

type RunStatement struct {
	Type  string `json:"type"`
	RunID string `json:"runId"`
	Index int    `json:"index"`
	SQL   string `json:"sql"`
}

type RunColumns struct {
	Type    string         `json:"type"`
	RunID   string         `json:"runId"`
	Index   int            `json:"index"`
	Columns []ResultColumn `json:"columns"`
}

type RunRows struct {
	Type  string `json:"type"`
	RunID string `json:"runId"`
	Index int    `json:"index"`
	Rows  []Row  `json:"rows"`
}

type RunNotice struct {
	Type    string `json:"type"`
	RunID   string `json:"runId"`
	Index   int    `json:"index"`
	Message string `json:"message"`
}

type RunResult struct {
	Type   string          `json:"type"`
	RunID  string          `json:"runId"`
	Result StatementResult `json:"result"`
}

type RunErrorEvent struct {
	Type  string     `json:"type"`
	RunID string     `json:"runId"`
	Index int        `json:"index"`
	Error QueryError `json:"error"`
}

type RunDoneEvent struct {
	Type       string    `json:"type"`
	RunID      string    `json:"runId"`
	Status     RunStatus `json:"status"`
	DurationMs int64     `json:"durationMs"`
}

func (e RunStart) EventType() string      { return e.Type }
func (e RunStatement) EventType() string  { return e.Type }
func (e RunColumns) EventType() string    { return e.Type }
func (e RunRows) EventType() string       { return e.Type }
func (e RunNotice) EventType() string     { return e.Type }
func (e RunResult) EventType() string     { return e.Type }
func (e RunErrorEvent) EventType() string { return e.Type }
func (e RunDoneEvent) EventType() string  { return e.Type }

func NewRunStart(runID string, statements int) RunStart {
	return RunStart{Type: "start", RunID: runID, Statements: statements}
}

func NewRunStatement(runID string, index int, sql string) RunStatement {
	return RunStatement{Type: "statement", RunID: runID, Index: index, SQL: sql}
}

func NewRunColumns(runID string, index int, columns []ResultColumn) RunColumns {
	if columns == nil {
		columns = make([]ResultColumn, 0)
	}
	return RunColumns{Type: "columns", RunID: runID, Index: index, Columns: columns}
}

func NewRunRows(runID string, index int, rows []Row) RunRows {
	if rows == nil {
		rows = make([]Row, 0)
	}
	return RunRows{Type: "rows", RunID: runID, Index: index, Rows: rows}
}

func NewRunNotice(runID string, index int, message string) RunNotice {
	return RunNotice{Type: "notice", RunID: runID, Index: index, Message: message}
}

func NewRunResult(runID string, result StatementResult) RunResult {
	return RunResult{Type: "result", RunID: runID, Result: result}
}

func NewRunError(runID string, index int, err QueryError) RunErrorEvent {
	return RunErrorEvent{Type: "error", RunID: runID, Index: index, Error: err}
}

func NewRunDone(runID string, status RunStatus, durationMs int64) RunDoneEvent {
	return RunDoneEvent{Type: "done", RunID: runID, Status: status, DurationMs: durationMs}
}

type QueryOptions struct {
	RunID     string `json:"runId"`
	Database  string `json:"database,omitempty"`
	MaxRows   int    `json:"maxRows,omitempty"`
	BatchSize int    `json:"batchSize,omitempty"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
	// Pointer because the default is true: an absent field must not read as false.
	Record   *bool `json:"record,omitempty"`
	ReadOnly bool  `json:"readOnly,omitempty"`
	// The workspace root this run belongs to; see RunRecord.Workspace.
	Workspace string `json:"workspace,omitempty"`
}

func (o QueryOptions) ShouldRecord() bool { return o.Record == nil || *o.Record }
