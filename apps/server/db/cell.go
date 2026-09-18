package db

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	"perch/protocol"
)

// toCell maps a driver value to the wire Cell the UI renders. Dates, byte slices and structured
// values become strings, because a grid cell is text.
//
// The shapes here are the ones node-postgres and mysql2 produced, not Go's defaults, because the
// UI and the CSV/JSON exports already parse those: int8 and numeric arrive as strings so large
// values survive JavaScript's 2^53, timestamps as ISO strings, and bytea as \x-prefixed hex.
func toCell(value any) protocol.Cell {
	switch v := value.(type) {
	case nil:
		return nil
	case bool:
		return v
	case string:
		return v
	case []byte:
		return `\x` + hex.EncodeToString(v)
	case [16]byte:
		// pgx decodes uuid to a raw array; json.Marshal would render it as 16 numbers.
		return fmt.Sprintf("%x-%x-%x-%x-%x", v[0:4], v[4:6], v[6:8], v[8:10], v[10:16])
	case int8:
		return int64(v)
	case int16:
		return int64(v)
	case int32:
		return int64(v)
	case int:
		return int64(v)
	case uint8:
		return int64(v)
	case uint16:
		return int64(v)
	case uint32:
		return int64(v)
	case int64:
		// node-postgres hands int8 back as a string so nothing is silently rounded in the
		// browser; keep that.
		return fmt.Sprintf("%d", v)
	case uint64:
		return fmt.Sprintf("%d", v)
	case float32:
		return float64(v)
	case float64:
		return v
	case time.Time:
		return protocol.ISOTime(v)
	case *big.Int:
		return v.String()
	case *big.Rat:
		return v.FloatString(20)
	case fmt.Stringer:
		return v.String()
	}

	// Arrays, composites, json and anything else a codec decoded into a Go value: the TypeScript
	// driver JSON-stringified these too.
	if encoded, err := json.Marshal(value); err == nil {
		return string(encoded)
	}
	return fmt.Sprintf("%v", value)
}

func toRow(values []any) protocol.Row {
	row := make(protocol.Row, len(values))
	for i, value := range values {
		row[i] = toCell(value)
	}
	return row
}
