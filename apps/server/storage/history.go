// Run history, on bbolt.
//
// It was a JSONL file that grew forever and was read whole to serve a page of fifty, and it threw
// every row away before writing — so a run from before a restart was a header with nothing behind
// it and a dead export link. Rows are the thing people come back to history for.
//
// bbolt gives the three properties that file could not: a write is a transaction, so a crash
// mid-run leaves no half-record; keys are ordered, so "newest fifty" is a reverse cursor that
// stops rather than a full read; and dropping the oldest is a delete from the front.
//
// Two buckets, because the header and the rows have different lifetimes and very different sizes:
//
//	runs  <startedAt>|<runID>  ->  the record, rows stripped: the ordered index a page is read from
//	full  <runID>              ->  deflate(JSON of the whole record, rows and all)
//
// The header is in both, which is a few hundred bytes of duplication that buys a fetch by run id
// — what "click a run from last week" needs — without a second index to keep in step.
//
// `startedAt` is protocol.ISOTime, which is fixed-width UTC, so it sorts lexicographically the way
// it sorts chronologically. The runID is appended to keep two runs in the same millisecond apart.

package storage

import (
	"bufio"
	"bytes"
	"compress/flate"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"

	"perch/protocol"
)

var (
	runsBucket  = []byte("runs")
	fullBucket  = []byte("full")
	metaBucket  = []byte("meta")
	storedBytes = []byte("storedBytes")
)

// Rows are JSON and compress about tenfold. Stdlib deflate rather than zstd: a dependency for a
// better ratio on data that is already a tenth of its size is weight for its own sake, and the
// binary is the product here.
const compressionLevel = flate.BestSpeed

// A single writer at a time is bbolt's own rule; this guards the lazy open, not the writes.
var (
	historyMu sync.Mutex
	historyDB *bolt.DB
)

// openHistory opens the database on first use and keeps it open: bbolt takes a file lock, so
// opening per call would serialise every reader behind every writer for no gain.
func openHistory() (*bolt.DB, error) {
	historyMu.Lock()
	defer historyMu.Unlock()
	if historyDB != nil {
		return historyDB, nil
	}

	dir, err := EnsureDir()
	if err != nil {
		return nil, err
	}
	// A lock that never clears would make perch unstartable, and the second instance already
	// refuses to serve — so it waits briefly and then gives up rather than hanging.
	db, err := bolt.Open(filepath.Join(dir, HistoryFile), 0o600, &bolt.Options{Timeout: 2 * time.Second})
	if err != nil {
		return nil, err
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		for _, name := range [][]byte{runsBucket, fullBucket, metaBucket} {
			if _, err := tx.CreateBucketIfNotExists(name); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		db.Close()
		return nil, err
	}

	historyDB = db
	// Best-effort: a history that cannot be carried over is not a reason to fail the run that
	// triggered the open.
	_ = importLegacyHistory(db, dir)
	return db, nil
}

// CloseHistory releases the file lock. Called on shutdown; safe to call twice.
func CloseHistory() error {
	historyMu.Lock()
	defer historyMu.Unlock()
	if historyDB == nil {
		return nil
	}
	err := historyDB.Close()
	historyDB = nil
	return err
}

func runKey(record protocol.RunRecord) []byte {
	return []byte(record.StartedAt + "|" + record.ID)
}

// AppendRun records a finished run. `keepRows` writes the result rows alongside the header; without
// it only the header is stored, which is what perch has always done.
func AppendRun(record protocol.RunRecord, keepRows bool) error {
	db, err := openHistory()
	if err != nil {
		return err
	}
	header, err := json.Marshal(stripRows(record))
	if err != nil {
		return err
	}
	var blob []byte
	if keepRows {
		if blob, err = compress(record); err != nil {
			return err
		}
	}

	return db.Update(func(tx *bolt.Tx) error {
		if err := tx.Bucket(runsBucket).Put(runKey(record), header); err != nil {
			return err
		}
		if blob != nil {
			if err := tx.Bucket(fullBucket).Put([]byte(record.ID), blob); err != nil {
				return err
			}
		}
		return addStored(tx, int64(len(header)+len(blob)))
	})
}

// A page of history: newest first, up to Limit, with rows stripped.
type HistoryQuery struct {
	Limit        int
	ConnectionID string
	// Which runs to include; see protocol.HistoryScope. The zero value is every run.
	Scope protocol.HistoryScope
	// The root Scope compares against, when it is `workspace`.
	Workspace string
}

func (q HistoryQuery) keep(record protocol.RunRecord) bool {
	if q.ConnectionID != "" && record.ConnectionID != q.ConnectionID {
		return false
	}
	switch q.Scope {
	case protocol.ScopeGlobal:
		return record.Workspace == ""
	case protocol.ScopeWorkspace:
		// The folder in front of you, plus the runs that belong to no folder: a scratch query is
		// part of what you were doing in this project even though no file holds it.
		return record.Workspace == "" || record.Workspace == q.Workspace
	}
	return true
}

// ListRuns returns the newest records first, up to the limit, without rows.
//
// The cursor walks backwards from the end and stops as soon as it has enough, so the cost is the
// page asked for rather than everything ever run. A filter still only reads until the limit is
// met — it just may walk further to get there.
func ListRuns(query HistoryQuery) ([]protocol.RunRecord, error) {
	db, err := openHistory()
	if err != nil {
		return nil, err
	}
	out := make([]protocol.RunRecord, 0, min(query.Limit, 256))
	err = db.View(func(tx *bolt.Tx) error {
		cursor := tx.Bucket(runsBucket).Cursor()
		for _, value := cursor.Last(); value != nil && len(out) < query.Limit; _, value = cursor.Prev() {
			var record protocol.RunRecord
			if json.Unmarshal(value, &record) != nil {
				continue // a record this build cannot read is not a reason to serve nothing
			}
			if !query.keep(record) {
				continue
			}
			out = append(out, record)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// FullRun reads back one run with its rows. The second return is false when the run is not in
// history, or was recorded without its rows — the caller still has the header from the list, so
// neither is an error.
func FullRun(runID string) (protocol.RunRecord, bool, error) {
	db, err := openHistory()
	if err != nil {
		return protocol.RunRecord{}, false, err
	}
	var blob []byte
	if err := db.View(func(tx *bolt.Tx) error {
		// A value is only valid inside its transaction, so it is copied before returning.
		if stored := tx.Bucket(fullBucket).Get([]byte(runID)); stored != nil {
			blob = bytes.Clone(stored)
		}
		return nil
	}); err != nil {
		return protocol.RunRecord{}, false, err
	}
	if blob == nil {
		return protocol.RunRecord{}, false, nil
	}
	record, err := decompress(blob)
	if err != nil {
		return protocol.RunRecord{}, false, err
	}
	return record, true, nil
}

// TrimHistory drops the oldest runs until both caps hold. Either cap is off when it is zero.
func TrimHistory(maxRuns int, maxBytes int64) error {
	if maxRuns <= 0 && maxBytes <= 0 {
		return nil
	}
	db, err := openHistory()
	if err != nil {
		return err
	}
	return db.Update(func(tx *bolt.Tx) error {
		runs := tx.Bucket(runsBucket)
		full := tx.Bucket(fullBucket)
		count := runs.Stats().KeyN
		stored := readStored(tx)

		cursor := runs.Cursor()
		for key, value := cursor.First(); key != nil; key, value = cursor.Next() {
			overCount := maxRuns > 0 && count > maxRuns
			overBytes := maxBytes > 0 && stored > maxBytes
			if !overCount && !overBytes {
				break
			}
			freed := int64(len(value))
			// The run id is the tail of the key, after the timestamp it is ordered by.
			if id := runIDFromKey(key); id != nil {
				if blob := full.Get(id); blob != nil {
					freed += int64(len(blob))
					if err := full.Delete(id); err != nil {
						return err
					}
				}
			}
			if err := cursor.Delete(); err != nil {
				return err
			}
			count--
			stored -= freed
		}
		return writeStored(tx, max(stored, 0))
	})
}

// ClearHistory empties both buckets, leaving the file in place for the next run to reuse.
func ClearHistory() error {
	db, err := openHistory()
	if err != nil {
		return err
	}
	return db.Update(func(tx *bolt.Tx) error {
		for _, name := range [][]byte{runsBucket, fullBucket} {
			if err := tx.DeleteBucket(name); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
				return err
			}
			if _, err := tx.CreateBucketIfNotExists(name); err != nil {
				return err
			}
		}
		return writeStored(tx, 0)
	})
}

func HistoryStats() (protocol.HistoryStats, error) {
	db, err := openHistory()
	if err != nil {
		return protocol.HistoryStats{}, err
	}
	stats := protocol.HistoryStats{}
	if err := db.View(func(tx *bolt.Tx) error {
		stats.Runs = tx.Bucket(runsBucket).Stats().KeyN
		stats.Bytes = readStored(tx)
		return nil
	}); err != nil {
		return stats, err
	}
	if info, err := os.Stat(db.Path()); err == nil {
		stats.FileBytes = info.Size()
	}
	return stats, nil
}

// stripRows copies the record with results that carry counts but no row data.
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

func runIDFromKey(key []byte) []byte {
	at := bytes.LastIndexByte(key, '|')
	if at == -1 || at == len(key)-1 {
		return nil
	}
	return bytes.Clone(key[at+1:])
}

func compress(record protocol.RunRecord) ([]byte, error) {
	raw, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	writer, err := flate.NewWriter(&buf, compressionLevel)
	if err != nil {
		return nil, err
	}
	if _, err := writer.Write(raw); err != nil {
		writer.Close()
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func decompress(blob []byte) (protocol.RunRecord, error) {
	var record protocol.RunRecord
	reader := flate.NewReader(bytes.NewReader(blob))
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		return record, err
	}
	err = json.Unmarshal(raw, &record)
	return record, err
}

// How many bytes of records the store holds, kept as a counter rather than measured: summing every
// value to answer "am I over the cap?" would read the whole database on every run, which is the
// cost this store exists to avoid.
func readStored(tx *bolt.Tx) int64 {
	raw := tx.Bucket(metaBucket).Get(storedBytes)
	if len(raw) != 8 {
		return 0
	}
	return int64(binary.BigEndian.Uint64(raw))
}

func writeStored(tx *bolt.Tx, value int64) error {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(max(value, 0)))
	return tx.Bucket(metaBucket).Put(storedBytes, buf[:])
}

func addStored(tx *bolt.Tx, delta int64) error {
	return writeStored(tx, readStored(tx)+delta)
}

// importLegacyHistory carries a pre-bbolt history.jsonl across, once. The old file is renamed
// rather than deleted: it is the only copy of those runs, and a migration that eats them because
// one line failed to parse is worse than a file left behind.
func importLegacyHistory(db *bolt.DB, dir string) error {
	legacy := filepath.Join(dir, legacyHistoryFile)
	file, err := os.Open(legacy)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	err = db.Update(func(tx *bolt.Tx) error {
		runs := tx.Bucket(runsBucket)
		var added int64
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var record protocol.RunRecord
			if json.Unmarshal([]byte(line), &record) != nil || record.ID == "" {
				continue
			}
			// The old file never held rows, so there is nothing to put in the full bucket.
			header, err := json.Marshal(stripRows(record))
			if err != nil {
				continue
			}
			if err := runs.Put(runKey(record), header); err != nil {
				return err
			}
			added += int64(len(header))
		}
		if err := scanner.Err(); err != nil {
			return err
		}
		return addStored(tx, added)
	})
	if err != nil {
		return err
	}
	return os.Rename(legacy, legacy+".imported")
}
