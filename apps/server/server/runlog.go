package server

import (
	"sort"
	"sync"

	"perch/protocol"
)

const maxRuns = 50

// RunLog is the in-memory record of recent runs, so /api/runs/:id and the exports can serve rows
// the on-disk history deliberately drops. Bounded: the oldest run falls out at the cap.
type RunLog struct {
	mu    sync.Mutex
	runs  map[string]*protocol.RunRecord
	order []string
}

func NewRunLog() *RunLog {
	return &RunLog{runs: map[string]*protocol.RunRecord{}}
}

func (l *RunLog) Remember(record *protocol.RunRecord) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, exists := l.runs[record.ID]; !exists {
		l.order = append(l.order, record.ID)
	}
	l.runs[record.ID] = record
	for len(l.order) > maxRuns {
		oldest := l.order[0]
		if oldest == record.ID {
			break
		}
		l.order = l.order[1:]
		delete(l.runs, oldest)
	}
}

func (l *RunLog) Get(runID string) (protocol.RunRecord, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	record, ok := l.runs[runID]
	if !ok {
		return protocol.RunRecord{}, false
	}
	return *record, true
}

// List is newest first, without result rows — those come from Get.
func (l *RunLog) List() []protocol.RunRecord {
	l.mu.Lock()
	out := make([]protocol.RunRecord, 0, len(l.runs))
	for _, record := range l.runs {
		out = append(out, stripRows(*record))
	}
	l.mu.Unlock()

	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// stripRows copies the record with statement results that carry counts but no row data.
func stripRows(record protocol.RunRecord) protocol.RunRecord {
	if record.Results == nil {
		return record
	}
	slim := make([]protocol.StatementResult, len(record.Results))
	for i, result := range record.Results {
		result.Rows = make([]protocol.Row, 0)
		slim[i] = result
	}
	record.Results = slim
	return record
}
