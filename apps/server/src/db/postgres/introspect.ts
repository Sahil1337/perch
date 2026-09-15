// Reading a PostgreSQL database's schema tree straight out of the catalogs (pg_class /
// pg_attribute), in two queries rather than one per table.

import type pg from "pg";
import { type Column, type DatabaseSchema, type Schema, type Table } from "@perch/protocol";

const RELATIONS_SQL = `
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
 order by 1, 2`;

const COLUMNS_SQL = `
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
 order by 1, 2, 8`;

type RelationRow = {
  schema_name: string;
  table_name: string | null;
  relkind: string | null;
  row_estimate: string | number | null;
};

type ColumnRow = {
  schema_name: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_pk: boolean;
  position: number;
};

function relationKind(relkind: string): Table["kind"] {
  if (relkind === "v") return "view";
  if (relkind === "m") return "materialized_view";
  return "table";
}

export async function readSchema(client: pg.ClientBase, database: string): Promise<DatabaseSchema> {
  const [relations, columns] = await Promise.all([
    client.query<RelationRow>(RELATIONS_SQL),
    client.query<ColumnRow>(COLUMNS_SQL),
  ]);

  const byTable = new Map<string, Column[]>();
  for (const c of columns.rows) {
    const key = `${c.schema_name}.${c.table_name}`;
    const list = byTable.get(key) ?? [];
    list.push({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable,
      default: c.column_default,
      pk: c.is_pk,
      position: c.position,
    });
    byTable.set(key, list);
  }

  const schemas = new Map<string, Schema>();
  for (const r of relations.rows) {
    const schema = schemas.get(r.schema_name) ?? { name: r.schema_name, tables: [] };
    schemas.set(r.schema_name, schema);
    if (!r.table_name || !r.relkind) continue;
    const estimate = r.row_estimate === null ? Number.NaN : Number(r.row_estimate);
    const table: Table = {
      schema: r.schema_name,
      name: r.table_name,
      kind: relationKind(r.relkind),
      columns: byTable.get(`${r.schema_name}.${r.table_name}`) ?? [],
    };
    if (Number.isFinite(estimate) && estimate >= 0) table.rowEstimate = estimate;
    schema.tables.push(table);
  }

  return {
    database,
    schemas: [...schemas.values()],
    fetchedAt: new Date().toISOString(),
  };
}
