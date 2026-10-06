package db

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"perch/protocol"
)

// The schema tree comes straight out of the catalogs in whole-database queries rather than one per
// table: three for the tree itself (columns, foreign keys, relations), any of which failing fails
// the fetch, then two round trips for triggers, which are best-effort (see readPgTriggers).

// The system catalogs and every session's temp schemas stay out of the tree. Each query aliases
// the namespace it filters on as n.
const pgUserSchemas = `n.nspname not in ('pg_catalog','information_schema','pg_toast')
   and n.nspname not like 'pg_temp%'
   and n.nspname not like 'pg_toast_temp%'`

const pgRelationsSQL = `
select n.nspname                                as schema_name,
       c.relname                                as table_name,
       c.relkind                                as relkind,
       case when c.relkind in ('r','p','m') then c.reltuples::bigint else null end as row_estimate
  from pg_namespace n
  left join pg_class c
    on c.relnamespace = n.oid
   and c.relkind in ('r','p','v','m','f')
 where ` + pgUserSchemas + `
 order by 1, 2`

const pgColumnsSQL = `
select n.nspname                                   as schema_name,
       c.relname                                   as table_name,
       a.attname                                   as column_name,
       format_type(a.atttypid, a.atttypmod)        as data_type,
       not a.attnotnull                            as is_nullable,
       pg_get_expr(d.adbin, d.adrelid)             as column_default,
       coalesce(i.indisprimary, false)             as is_pk,
       a.attnum                                    as position
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  left join pg_index i on i.indrelid = a.attrelid and i.indisprimary and a.attnum = any (i.indkey)
 where a.attnum > 0
   and not a.attisdropped
   and c.relkind in ('r','p','v','m','f')
   and ` + pgUserSchemas + `
 order by 1, 2, 8`

// conkey/confkey are parallel attnum arrays, so they are unnested together with ordinality to
// keep a composite key's columns paired and in constraint order.
const pgForeignKeysSQL = `
select n.nspname        as schema_name,
       c.relname        as table_name,
       con.conname      as constraint_name,
       fn.nspname       as ref_schema,
       fc.relname       as ref_table,
       k.columns        as columns,
       k.ref_columns    as ref_columns,
       con.confdeltype  as on_delete,
       con.confupdtype  as on_update
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_class fc on fc.oid = con.confrelid
  join pg_namespace fn on fn.oid = fc.relnamespace
  cross join lateral (
    select array_agg(a.attname::text order by u.ord)  as columns,
           array_agg(fa.attname::text order by u.ord) as ref_columns
      from unnest(con.conkey, con.confkey) with ordinality as u(attnum, ref_attnum, ord)
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.attnum
      join pg_attribute fa on fa.attrelid = con.confrelid and fa.attnum = u.ref_attnum
  ) k
 where con.contype = 'f'
   and ` + pgUserSchemas + `
 order by 1, 2, 3`

// Postgres fires the triggers of one timing and level in byte order of their names, so ordering
// by tgname in the "C" collation hands the UI firing order. tgattr keeps UPDATE OF columns in the
// order they were declared. Two definitions come back: the plain one is what the UI shows and
// reuses, and the pretty one is only for reading WHEN, which the plain one wraps in extra
// parentheses.
const pgTriggersSQL = `
select n.nspname                             as schema_name,
       c.relname                             as table_name,
       t.tgname                              as trigger_name,
       t.tgtype                              as tgtype,
       t.tgenabled                           as tgenabled,
       t.tgconstraint <> 0                   as is_constraint,
       t.tginitdeferred                      as initially_deferred,
       t.tgoldtable is not null or t.tgnewtable is not null as transition_tables,
       coalesce(u.columns, '{}')             as columns,
       t.tgnargs                             as nargs,
       t.tgargs                              as args,
       fn.nspname                            as function_schema,
       p.proname                             as function_name,
       obj_description(t.oid, 'pg_trigger')  as comment,
       pg_get_triggerdef(t.oid, false)       as definition,
       pg_get_triggerdef(t.oid, true)        as pretty_definition
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace fn on fn.oid = p.pronamespace
  cross join lateral (
    select array_agg(a.attname::text order by k.ord) as columns
      from unnest(t.tgattr) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k.attnum
  ) u
 where not t.tgisinternal
   and ` + pgUserSchemas

const pgTriggersOrder = `
 order by n.nspname, c.relname, t.tgname collate "C"`

// CREATE TRIGGER only accepts a function with no declared arguments, so pronargs = 0 keeps the
// list to functions a trigger can use and makes schema + name a key for them.
const pgTriggerFunctionsSQL = `
select n.nspname  as schema_name,
       p.proname  as function_name,
       l.lanname  as language,
       e.extname  as extension
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  left join pg_depend d
    on d.classid = 'pg_proc'::regclass
   and d.objid = p.oid
   and d.refclassid = 'pg_extension'::regclass
   and d.deptype = 'e'
  left join pg_extension e on e.oid = d.refobjid
 where p.prorettype = 'trigger'::regtype
   and p.pronargs = 0
   and ` + pgUserSchemas + `
 order by 1, 2`

const pgPartitionsSQL = `
select n.nspname as schema_name,
       c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relispartition
   and ` + pgUserSchemas

// pg_trigger.tgtype bits, from Postgres's catalog/pg_trigger.h. A trigger that is neither BEFORE
// nor INSTEAD OF is AFTER.
const (
	tgTypeRow      = 1 << 0
	tgTypeBefore   = 1 << 1
	tgTypeInsert   = 1 << 2
	tgTypeDelete   = 1 << 3
	tgTypeUpdate   = 1 << 4
	tgTypeTruncate = 1 << 5
	tgTypeInstead  = 1 << 6
)

func (d *postgresDriver) GetSchema(ctx context.Context, database string) (protocol.DatabaseSchema, error) {
	target := database
	if target == "" {
		target = d.config.Database
	}
	pool, err := d.poolFor(ctx, database)
	if err != nil {
		return protocol.DatabaseSchema{}, err
	}
	return readPgSchema(ctx, pool, target)
}

func readPgSchema(ctx context.Context, pool *pgxpool.Pool, database string) (protocol.DatabaseSchema, error) {
	var zero protocol.DatabaseSchema

	columnsByTable := map[string][]protocol.Column{}
	rows, err := pool.Query(ctx, pgColumnsSQL)
	if err != nil {
		return zero, err
	}
	for rows.Next() {
		var schemaName, tableName string
		var column protocol.Column
		if err := rows.Scan(&schemaName, &tableName, &column.Name, &column.Type,
			&column.Nullable, &column.Default, &column.PK, &column.Position); err != nil {
			rows.Close()
			return zero, err
		}
		key := schemaName + "." + tableName
		columnsByTable[key] = append(columnsByTable[key], column)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return zero, err
	}

	fksByTable := map[string][]protocol.ForeignKey{}
	rows, err = pool.Query(ctx, pgForeignKeysSQL)
	if err != nil {
		return zero, err
	}
	for rows.Next() {
		var schemaName, tableName, onDelete, onUpdate string
		fk := protocol.ForeignKey{}
		if err := rows.Scan(&schemaName, &tableName, &fk.Name, &fk.RefSchema, &fk.RefTable,
			&fk.Columns, &fk.RefColumns, &onDelete, &onUpdate); err != nil {
			rows.Close()
			return zero, err
		}
		fk.OnDelete = referentialAction(onDelete)
		fk.OnUpdate = referentialAction(onUpdate)
		if fk.Columns == nil {
			fk.Columns = []string{}
		}
		if fk.RefColumns == nil {
			fk.RefColumns = []string{}
		}
		key := schemaName + "." + tableName
		fksByTable[key] = append(fksByTable[key], fk)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return zero, err
	}

	triggers := readPgTriggers(ctx, pool)
	// readPgTriggers swallows cancellation along with everything else, and a tree without its
	// triggers must not be answered and cached as if it were whole.
	if err := ctx.Err(); err != nil {
		return zero, err
	}

	rows, err = pool.Query(ctx, pgRelationsSQL)
	if err != nil {
		return zero, err
	}
	schemas := make([]protocol.Schema, 0)
	index := map[string]int{}
	for rows.Next() {
		var schemaName string
		var tableName, relkind *string
		var rowEstimate *int64
		if err := rows.Scan(&schemaName, &tableName, &relkind, &rowEstimate); err != nil {
			rows.Close()
			return zero, err
		}
		at, ok := index[schemaName]
		if !ok {
			// A schema with no relations still belongs in the tree, which is why the catalog
			// query left-joins pg_class.
			schemas = append(schemas, protocol.Schema{Name: schemaName, Tables: []protocol.Table{}})
			at = len(schemas) - 1
			index[schemaName] = at
		}
		if tableName == nil || relkind == nil {
			continue
		}
		key := schemaName + "." + *tableName
		table := protocol.Table{
			Schema:      schemaName,
			Name:        *tableName,
			Kind:        relationKind(*relkind),
			Columns:     columnsByTable[key],
			ForeignKeys: fksByTable[key],
			Triggers:    triggers.byTable[key],
			IsPartition: triggers.partitions[key],
		}
		if table.Columns == nil {
			table.Columns = []protocol.Column{}
		}
		if table.ForeignKeys == nil {
			table.ForeignKeys = []protocol.ForeignKey{}
		}
		if table.Triggers == nil {
			table.Triggers = []protocol.Trigger{}
		}
		if rowEstimate != nil && *rowEstimate >= 0 {
			table.RowEstimate = rowEstimate
		}
		schemas[at].Tables = append(schemas[at].Tables, table)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return zero, err
	}

	return protocol.DatabaseSchema{
		Database:         database,
		Schemas:          schemas,
		TriggerFunctions: triggers.functions,
		ServerVersionNum: triggers.version,
		FetchedAt:        protocol.Now(),
	}, nil
}

type pgTriggerCatalog struct {
	version    *int
	byTable    map[string][]protocol.Trigger
	partitions map[string]bool
	functions  []protocol.TriggerFunction
}

// readPgTriggers never fails the tree. A Postgres-wire lookalike with a partial pg_trigger, a
// server older than the columns asked for, or a trigger dropped mid-fetch costs the trigger
// list and nothing else.
//
// The version comes first because the SQL depends on it: tgparentid only exists from 13, which
// is also when partition clones stopped being marked tgisinternal. Everything else then goes in
// one pipelined round trip.
func readPgTriggers(ctx context.Context, pool *pgxpool.Pool) pgTriggerCatalog {
	none := pgTriggerCatalog{functions: []protocol.TriggerFunction{}}
	var version int
	if err := pool.QueryRow(ctx, `select current_setting('server_version_num')::int`).Scan(&version); err != nil {
		return none
	}
	none.version = &version

	found := pgTriggerCatalog{
		version:    &version,
		byTable:    map[string][]protocol.Trigger{},
		partitions: map[string]bool{},
		functions:  []protocol.TriggerFunction{},
	}
	triggersSQL := pgTriggersSQL
	if version >= 130000 {
		triggersSQL += `
   and t.tgparentid = 0`
	}
	batch := &pgx.Batch{}
	batch.Queue(triggersSQL + pgTriggersOrder).Query(func(rows pgx.Rows) error {
		for rows.Next() {
			var schemaName, tableName, tgenabled string
			var tgtype, nargs int16
			var args []byte
			var definition, pretty *string
			trigger := protocol.Trigger{}
			if err := rows.Scan(&schemaName, &tableName, &trigger.Name, &tgtype, &tgenabled,
				&trigger.Constraint, &trigger.InitiallyDeferred, &trigger.TransitionTables,
				&trigger.Columns, &nargs, &args, &trigger.Function.Schema, &trigger.Function.Name,
				&trigger.Comment, &definition, &pretty); err != nil {
				return err
			}
			// Both are NULL when the trigger went away between the catalog scan and the call.
			if definition == nil || pretty == nil {
				continue
			}
			trigger.Timing = triggerTiming(tgtype)
			trigger.Operations = triggerOperations(tgtype)
			trigger.Level = protocol.LevelStatement
			if tgtype&tgTypeRow != 0 {
				trigger.Level = protocol.LevelRow
			}
			trigger.State = triggerState(tgenabled)
			trigger.Arguments = triggerArguments(args, int(nargs))
			trigger.Condition = triggerCondition(*pretty)
			trigger.Definition = *definition
			if trigger.Columns == nil {
				trigger.Columns = []string{}
			}
			key := schemaName + "." + tableName
			found.byTable[key] = append(found.byTable[key], trigger)
		}
		return nil
	})
	batch.Queue(pgTriggerFunctionsSQL).Query(func(rows pgx.Rows) error {
		for rows.Next() {
			var fn protocol.TriggerFunction
			if err := rows.Scan(&fn.Schema, &fn.Name, &fn.Language, &fn.Extension); err != nil {
				return err
			}
			found.functions = append(found.functions, fn)
		}
		return nil
	})
	batch.Queue(pgPartitionsSQL).Query(func(rows pgx.Rows) error {
		for rows.Next() {
			var schemaName, tableName string
			if err := rows.Scan(&schemaName, &tableName); err != nil {
				return err
			}
			found.partitions[schemaName+"."+tableName] = true
		}
		return nil
	})
	if err := pool.SendBatch(ctx, batch).Close(); err != nil {
		return none
	}
	return found
}

func triggerTiming(tgtype int16) protocol.TriggerTiming {
	switch {
	case tgtype&tgTypeInstead != 0:
		return protocol.TimingInsteadOf
	case tgtype&tgTypeBefore != 0:
		return protocol.TimingBefore
	}
	return protocol.TimingAfter
}

// The wire order is fixed rather than tgtype's bit order, which puts delete before update.
func triggerOperations(tgtype int16) []protocol.TriggerOperation {
	operations := make([]protocol.TriggerOperation, 0, 4)
	for _, op := range []struct {
		bit       int16
		operation protocol.TriggerOperation
	}{
		{tgTypeInsert, protocol.OperationInsert},
		{tgTypeUpdate, protocol.OperationUpdate},
		{tgTypeDelete, protocol.OperationDelete},
		{tgTypeTruncate, protocol.OperationTruncate},
	} {
		if tgtype&op.bit != 0 {
			operations = append(operations, op.operation)
		}
	}
	return operations
}

func triggerState(tgenabled string) protocol.TriggerState {
	switch tgenabled {
	case "D":
		return protocol.StateDisabled
	case "R":
		return protocol.StateReplica
	case "A":
		return protocol.StateAlways
	}
	return protocol.StateEnabled
}

// tgargs holds each argument followed by a NUL, so an empty argument is a lone NUL and
// splitting leaves one extra empty piece after the last.
func triggerArguments(tgargs []byte, count int) []string {
	parts := strings.Split(string(tgargs), "\x00")
	return parts[:min(count, len(parts))]
}

// triggerCondition reads the WHEN body out of pg_get_triggerdef's text, or nil when there is none.
// Only a WHEN outside every literal and quoted identifier counts, since a trigger's name or a
// string constant can hold " WHEN (" or an unbalanced parenthesis. Looking for the EXECUTE that
// follows would not work either: a condition like new.note <> ' EXECUTE ' prints verbatim.
func triggerCondition(definition string) *string {
	const clause = " WHEN ("
	depth, start := 0, -1
	for i := 0; i < len(definition); i++ {
		switch definition[i] {
		case '\'', '"':
			i = closingQuote(definition, i)
		case '(':
			if depth == 0 && start < 0 && strings.HasSuffix(definition[:i+1], clause) {
				start = i + 1
			}
			depth++
		case ')':
			depth--
			if depth == 0 && start >= 0 {
				condition := definition[start:i]
				return &condition
			}
		}
	}
	return nil
}

// closingQuote returns the index of the quote that ends the literal or quoted identifier opening
// at open. A doubled quote is an escaped one; inside E'…' a backslash escapes too.
func closingQuote(s string, open int) int {
	quote := s[open]
	escapes := quote == '\'' && open > 0 && (s[open-1] == 'E' || s[open-1] == 'e') &&
		(open < 2 || !isIdentifierByte(s[open-2]))
	for i := open + 1; i < len(s); i++ {
		switch {
		case escapes && s[i] == '\\':
			i++
		case s[i] == quote:
			if i+1 < len(s) && s[i+1] == quote {
				i++
				continue
			}
			return i
		}
	}
	return len(s)
}

func isIdentifierByte(b byte) bool {
	return b == '_' || b == '$' || b >= 0x80 ||
		('a' <= b && b <= 'z') || ('A' <= b && b <= 'Z') || ('0' <= b && b <= '9')
}

func relationKind(relkind string) protocol.TableKind {
	switch relkind {
	case "v":
		return protocol.KindView
	case "m":
		return protocol.KindMaterializedView
	}
	return protocol.KindTable
}

// confdeltype/confupdtype are single characters; spell them the way SQL does.
func referentialAction(code string) string {
	switch code {
	case "r":
		return "RESTRICT"
	case "c":
		return "CASCADE"
	case "n":
		return "SET NULL"
	case "d":
		return "SET DEFAULT"
	}
	return "NO ACTION"
}
