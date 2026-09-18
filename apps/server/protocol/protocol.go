// Package protocol is everything crossing the wire. It must stay field-for-field identical to
// the TypeScript @perch/protocol the UI parses, which constrains three things Go gets wrong by
// default: `T?` is omitempty, `T | null` is a pointer WITHOUT omitempty (it must serialise as
// null, not vanish), and a required slice must never be nil (Go marshals nil to null, not []).
package protocol

import "time"

type Dialect string

const (
	DialectPostgres Dialect = "postgres"
	DialectMySQL    Dialect = "mysql"
)

type Align string

const (
	AlignLeft  Align = "left"
	AlignRight Align = "right"
)

// ISOTime matches JavaScript's Date.toISOString(): UTC, milliseconds, trailing Z. Timestamps
// are compared as strings on the wire — PUT /api/files/content sends back the ifModifiedAt it
// was given — so the format has to be exactly what the TypeScript server wrote.
func ISOTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

func Now() string { return ISOTime(time.Now()) }
