package db

import (
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"perch/protocol"
)

// Builtin OIDs worth naming; anything else is reported as oid:<n>.
var pgOIDNames = map[uint32]string{
	16: "bool", 20: "int8", 21: "int2", 23: "int4", 25: "text",
	114: "json", 700: "float4", 701: "float8", 1042: "bpchar", 1043: "varchar",
	1082: "date", 1083: "time", 1114: "timestamp", 1184: "timestamptz",
	1186: "interval", 1700: "numeric", 2950: "uuid", 3802: "jsonb",
}

var rightAligned = map[string]bool{
	"int2": true, "int4": true, "int8": true, "float4": true, "float8": true,
	"numeric": true, "date": true, "time": true, "timestamp": true, "timestamptz": true,
	// MySQL spellings.
	"tinyint": true, "smallint": true, "mediumint": true, "int": true, "bigint": true,
	"decimal": true, "float": true, "double": true, "year": true, "datetime": true,
}

func pgTypeName(oid uint32) string {
	if name, ok := pgOIDNames[oid]; ok {
		return name
	}
	return "oid:" + strconv.Itoa(int(oid))
}

func alignFor(typeName string) protocol.Align {
	if rightAligned[typeName] {
		return protocol.AlignRight
	}
	return protocol.AlignLeft
}

func pgResultColumn(field pgconn.FieldDescription) protocol.ResultColumn {
	name := pgTypeName(field.DataTypeOID)
	return protocol.ResultColumn{Name: field.Name, Type: name, Align: alignFor(name)}
}

func lineOfOffset(sql string, offset int) int {
	line := 1
	for i := 0; i < offset && i < len(sql); i++ {
		if sql[i] == '\n' {
			line++
		}
	}
	return line
}

func pgQueryError(err error, statementSQL string) protocol.QueryError {
	out := protocol.QueryError{Message: err.Error()}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return out
	}
	out.Message = pgErr.Message
	out.Code = pgErr.Code
	out.Detail = pgErr.Detail
	out.Hint = pgErr.Hint
	if pgErr.Position > 0 {
		position := int(pgErr.Position) - 1
		line := lineOfOffset(statementSQL, position)
		out.Position = &position
		out.Line = &line
	}
	return out
}

// looksRowReturning reports whether a statement is expected to produce a result set.
// Row-returning statements stream through a cursor; the rest go through the simple protocol,
// which is the only one that can run e.g. VACUUM. A wrong guess costs streaming, never
// correctness — the rows are emitted either way.
func looksRowReturning(sql string) bool {
	switch firstWord(sql) {
	case "select", "with", "table", "values", "show", "explain", "fetch":
		return true
	case "insert", "update", "delete", "merge":
		return strings.Contains(strings.ToLower(sql), "returning")
	}
	return false
}
