package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"perch/protocol"
)

// The schema tree comes straight out of the catalogs in three queries rather than one per table.

const pgRelationsSQL = `
select n.nspname                                as schema_name,
       c.relname                                as table_name,
       c.relkind                                as relkind,
       case when c.relkind in ('r','p','m') then c.reltuples::bigint else null end as row_estimate
  from pg_namespace n
  left join pg_class c
    on c.relnamespace = n.oid
   and c.relkind in ('r','p','v','m','f')
 where n.nspname not in ('pg_catalog','information_schema','pg_toast')
   and n.nspname not like 'pg_temp%'
   and n.nspname not like 'pg_toast_temp%'
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
   and n.nspname not in ('pg_catalog','information_schema','pg_toast')
   and n.nspname not like 'pg_temp%'
   and n.nspname not like 'pg_toast_temp%'
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
   and n.nspname not in ('pg_catalog','information_schema','pg_toast')
   and n.nspname not like 'pg_temp%'
   and n.nspname not like 'pg_toast_temp%'
 order by 1, 2, 3`

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
		}
		if table.Columns == nil {
			table.Columns = []protocol.Column{}
		}
		if table.ForeignKeys == nil {
			table.ForeignKeys = []protocol.ForeignKey{}
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

	return protocol.DatabaseSchema{Database: database, Schemas: schemas, FetchedAt: protocol.Now()}, nil
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
