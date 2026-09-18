package server

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"perch/httpx"
	"perch/protocol"
	"perch/storage"
)

func (s *Server) registerRuns() {
	s.handle("POST /api/runs/{id}/cancel", func(w http.ResponseWriter, r *http.Request) error {
		return httpx.JSON(w, map[string]any{"cancelled": s.runner.CancelRun(r.PathValue("id"))})
	})

	s.handle("GET /api/runs", func(w http.ResponseWriter, r *http.Request) error {
		return httpx.JSON(w, s.runLog.List())
	})

	s.handle("GET /api/runs/{id}", func(w http.ResponseWriter, r *http.Request) error {
		run, ok := s.runLog.Get(r.PathValue("id"))
		if !ok {
			return httpx.NotFound("no such run: " + r.PathValue("id"))
		}
		return httpx.JSON(w, run)
	})

	s.handle("GET /api/runs/{id}/export", func(w http.ResponseWriter, r *http.Request) error {
		run, ok := s.runLog.Get(r.PathValue("id"))
		if !ok {
			return httpx.NotFound("no such run: " + r.PathValue("id"))
		}
		query := r.URL.Query()
		format := strings.ToLower(query.Get("format"))
		if format == "" {
			format = "csv"
		}
		index := 0
		if raw := query.Get("statement"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil {
				return httpx.BadRequest("statement must be a number")
			}
			index = parsed
		}
		if index < 0 || index >= len(run.Results) {
			return httpx.NotFound(fmt.Sprintf("run has no statement %d", index))
		}
		result := run.Results[index]

		id := run.ID
		if len(id) > 8 {
			id = id[:8]
		}
		stamp := fmt.Sprintf("%s-%d", id, index)

		switch format {
		case "json":
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename="perch-`+stamp+`.json"`)
			body, err := json.MarshalIndent(rowsToObjects(result.Columns, result.Rows), "", "  ")
			if err != nil {
				return err
			}
			_, err = w.Write(append(body, '\n'))
			return err
		case "csv":
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename="perch-`+stamp+`.csv"`)
			return writeCSV(w, result)
		}
		return httpx.BadRequest("unsupported export format: " + format)
	})
}

func (s *Server) registerHistory() {
	s.handle("GET /api/history", func(w http.ResponseWriter, r *http.Request) error {
		query := r.URL.Query()
		limit := 50
		if raw := query.Get("limit"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil {
				return httpx.BadRequest("limit must be a number")
			}
			limit = parsed
		}
		limit = min(1000, max(1, limit))
		records, err := storage.ReadHistory(limit, query.Get("connectionId"))
		if err != nil {
			return err
		}
		return httpx.JSON(w, records)
	})
}

func rowsToObjects(columns []protocol.ResultColumn, rows []protocol.Row) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		object := make(map[string]any, len(columns))
		for i, column := range columns {
			if i < len(row) {
				object[column.Name] = row[i]
			}
		}
		out = append(out, object)
	}
	return out
}

func writeCSV(w http.ResponseWriter, result protocol.StatementResult) error {
	out := csv.NewWriter(w)
	header := make([]string, len(result.Columns))
	for i, column := range result.Columns {
		header[i] = column.Name
	}
	if err := out.Write(header); err != nil {
		return err
	}
	for _, row := range result.Rows {
		record := make([]string, len(header))
		for i := range header {
			if i < len(row) {
				record[i] = csvCell(row[i])
			}
		}
		if err := out.Write(record); err != nil {
			return err
		}
	}
	out.Flush()
	return out.Error()
}

// A null cell is an empty field, which is what a spreadsheet reads back as blank.
func csvCell(value protocol.Cell) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(v, 10)
	}
	return fmt.Sprintf("%v", value)
}
