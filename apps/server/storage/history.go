package storage

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"perch/protocol"
)

var historyMu sync.Mutex

// AppendHistory records the shape and counts of a run, never its data: rows are stripped before
// the record reaches disk.
func AppendHistory(record protocol.RunRecord) error {
	historyMu.Lock()
	defer historyMu.Unlock()

	dir, err := EnsureDir()
	if err != nil {
		return err
	}
	if record.Results != nil {
		slim := make([]protocol.StatementResult, len(record.Results))
		for i, r := range record.Results {
			r.Rows = make([]protocol.Row, 0)
			slim[i] = r
		}
		record.Results = slim
	}
	line, err := json.Marshal(record)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, HistoryFile), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(line, '\n'))
	return err
}

// ReadHistory returns the newest records first, up to limit.
func ReadHistory(limit int, connectionID string) ([]protocol.RunRecord, error) {
	dir, err := EnsureDir()
	if err != nil {
		return nil, err
	}
	f, err := os.Open(filepath.Join(dir, HistoryFile))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []protocol.RunRecord{}, nil
		}
		return nil, err
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" {
			lines = append(lines, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	out := make([]protocol.RunRecord, 0, limit)
	for i := len(lines) - 1; i >= 0 && len(out) < limit; i-- {
		var rec protocol.RunRecord
		if json.Unmarshal([]byte(lines[i]), &rec) != nil {
			continue // skip a corrupt line
		}
		if connectionID != "" && rec.ConnectionID != connectionID {
			continue
		}
		out = append(out, rec)
	}
	return out, nil
}
