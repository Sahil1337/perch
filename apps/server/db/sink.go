package db

import (
	"time"

	"perch/protocol"
)

// Sink is everything one statement produces, on its way to the client. A dialect pushes columns,
// rows, notices and counts in whatever order its API hands them over; the sink owns the maxRows
// cut, the batching into `rows` events, and the StatementResult.
type Sink struct {
	runID     string
	index     int
	sql       string
	maxRows   int
	batchSize int
	emit      func(protocol.RunEvent)

	startedAt time.Time
	rows      []protocol.Row
	notices   []string
	columns   []protocol.ResultColumn
	pending   []protocol.Row
	stop      func()
	affected  *int64
	command   *string
	truncated bool
}

func NewSink(runID string, index int, sql string, maxRows, batchSize int, emit func(protocol.RunEvent)) *Sink {
	return &Sink{
		runID:     runID,
		index:     index,
		sql:       sql,
		maxRows:   maxRows,
		batchSize: batchSize,
		emit:      emit,
		startedAt: time.Now(),
		rows:      make([]protocol.Row, 0),
		notices:   make([]string, 0),
		columns:   make([]protocol.ResultColumn, 0),
	}
}

// OnStop registers what to call the moment maxRows is reached, so a dialect being pushed rows
// can destroy its source. A dialect that pulls can check Truncated after handing rows over.
func (s *Sink) OnStop(fn func()) { s.stop = fn }

func (s *Sink) Truncated() bool { return s.truncated }

// RowCount is the rows kept so far — a cursor uses it, with MaxRows, to size its next read.
func (s *Sink) RowCount() int { return len(s.rows) }

func (s *Sink) MaxRows() int { return s.maxRows }

// HasColumns reports whether a result set was announced: what tells a DML statement from a SELECT.
func (s *Sink) HasColumns() bool { return len(s.columns) > 0 }

// Columns keeps the first non-empty list; a later result set is ignored.
func (s *Sink) Columns(columns []protocol.ResultColumn) {
	if len(s.columns) > 0 || len(columns) == 0 {
		return
	}
	s.columns = columns
	s.emit(protocol.NewRunColumns(s.runID, s.index, columns))
}

func (s *Sink) Row(row protocol.Row) {
	if len(s.rows) >= s.maxRows {
		if !s.truncated {
			s.truncated = true
			s.Flush()
			if s.stop != nil {
				s.stop()
			}
		}
		return
	}
	s.rows = append(s.rows, row)
	s.pending = append(s.pending, row)
	if len(s.pending) >= s.batchSize {
		s.Flush()
	}
}

func (s *Sink) Notice(message string) {
	s.notices = append(s.notices, message)
	s.emit(protocol.NewRunNotice(s.runID, s.index, message))
}

func (s *Sink) Affected(rows int64) { s.affected = &rows }

func (s *Sink) Command(command string) {
	if command != "" {
		s.command = &command
	}
}

// Flush emits whatever rows are queued. Called automatically at the batch size and on finish.
func (s *Sink) Flush() {
	if len(s.pending) == 0 {
		return
	}
	s.emit(protocol.NewRunRows(s.runID, s.index, s.pending))
	s.pending = nil
}

// Finish flushes, emits the result event, and returns the record the run log keeps.
func (s *Sink) Finish() protocol.StatementResult {
	s.Flush()
	result := protocol.StatementResult{
		Index:      s.index,
		SQL:        s.sql,
		Columns:    s.columns,
		Rows:       s.rows,
		RowCount:   len(s.rows),
		Command:    s.command,
		DurationMs: time.Since(s.startedAt).Milliseconds(),
		Truncated:  s.truncated,
		Notices:    s.notices,
	}
	// A statement that returned a result set reports rowCount, never affectedRows.
	if len(s.columns) == 0 {
		result.AffectedRows = s.affected
	}
	s.emit(protocol.NewRunResult(s.runID, result))
	return result
}
