package db

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"perch/protocol"
)

// Postgres reports each field's relation oid (0 for an expression) and attribute number but
// never the names, so they are resolved with one query per statement and remembered for the
// connection's lifetime — a repeated run then costs nothing. Best-effort throughout: a failed
// lookup only means columns without a source.
type columnSourceCache struct {
	mu sync.Mutex
	// Relation oids are per database, so one map each, keyed by database name.
	byDatabase map[string]map[string]protocol.ColumnSource
}

func newColumnSourceCache() *columnSourceCache {
	return &columnSourceCache{byDatabase: map[string]map[string]protocol.ColumnSource{}}
}

func sourceKey(oid uint32, attnum uint16) string {
	return fmt.Sprintf("%d:%d", oid, attnum)
}

func (c *columnSourceCache) resolve(ctx context.Context, pool *pgxpool.Pool, database string, fields []pgconn.FieldDescription) []protocol.ResultColumn {
	columns := make([]protocol.ResultColumn, len(fields))
	for i, field := range fields {
		columns[i] = pgResultColumn(field)
	}

	missing := map[string][2]any{}
	c.mu.Lock()
	cache, ok := c.byDatabase[database]
	if !ok {
		cache = map[string]protocol.ColumnSource{}
		c.byDatabase[database] = cache
	}
	for _, field := range fields {
		if field.TableOID == 0 || field.TableAttributeNumber == 0 {
			continue
		}
		key := sourceKey(field.TableOID, field.TableAttributeNumber)
		if _, hit := cache[key]; !hit {
			missing[key] = [2]any{field.TableOID, field.TableAttributeNumber}
		}
	}
	c.mu.Unlock()

	if len(missing) > 0 {
		c.lookup(ctx, pool, database, missing)
	}

	c.mu.Lock()
	cache = c.byDatabase[database]
	for i, field := range fields {
		if field.TableOID == 0 {
			continue
		}
		if source, hit := cache[sourceKey(field.TableOID, field.TableAttributeNumber)]; hit {
			s := source
			columns[i].Source = &s
		}
	}
	c.mu.Unlock()
	return columns
}

func (c *columnSourceCache) lookup(ctx context.Context, pool *pgxpool.Pool, database string, missing map[string][2]any) {
	tuples := make([]string, 0, len(missing))
	args := make([]any, 0, len(missing)*2)
	for _, pair := range missing {
		args = append(args, pair[0], pair[1])
		tuples = append(tuples, fmt.Sprintf("($%d::oid, $%d::int2)", len(args)-1, len(args)))
	}

	rows, err := pool.Query(ctx, `select attrelid, attnum, relname, attname from pg_attribute
		join pg_class on pg_class.oid = attrelid
		where (attrelid, attnum) in (`+strings.Join(tuples, ", ")+`)`, args...)
	if err != nil {
		// A dropped table or a permission gap: the columns simply go out without a source.
		return
	}
	defer rows.Close()

	found := map[string]protocol.ColumnSource{}
	for rows.Next() {
		var oid uint32
		var attnum int16
		var relname, attname string
		if err := rows.Scan(&oid, &attnum, &relname, &attname); err != nil {
			return
		}
		found[sourceKey(oid, uint16(attnum))] = protocol.ColumnSource{Table: relname, Column: attname}
	}
	if rows.Err() != nil {
		return
	}

	c.mu.Lock()
	cache, ok := c.byDatabase[database]
	if !ok {
		cache = map[string]protocol.ColumnSource{}
		c.byDatabase[database] = cache
	}
	for key, source := range found {
		cache[key] = source
	}
	c.mu.Unlock()
}
