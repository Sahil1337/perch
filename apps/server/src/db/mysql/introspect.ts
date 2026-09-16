// Reading a MySQL database's schema out of information_schema. MySQL's "schema" and "database"
// are the same thing, so the tree always has exactly one schema: the target database.

import type mysql from "mysql2/promise";
import {
  type Column,
  type DatabaseSchema,
  type ForeignKey,
  type Schema,
  type Table,
} from "@perch/protocol";

export async function readSchema(pool: mysql.Pool, target: string): Promise<DatabaseSchema> {
  const [tables] = await pool.query<mysql.RowDataPacket[]>(
    `select table_schema, table_name, table_type, table_rows
       from information_schema.tables
      where table_schema = ?
      order by table_name`,
    [target],
  );
  const [columns] = await pool.query<mysql.RowDataPacket[]>(
    `select c.table_schema, c.table_name, c.column_name, c.column_type, c.is_nullable,
            c.column_default, c.ordinal_position, c.column_key
       from information_schema.columns c
      where c.table_schema = ?
      order by c.table_name, c.ordinal_position`,
    [target],
  );

  // One row per foreign-key column; the rows of a constraint arrive adjacent and in
  // ordinal_position order, so a composite key keeps its column pairing.
  const [foreignKeys] = await pool.query<mysql.RowDataPacket[]>(
    `select k.table_name, k.constraint_name, k.column_name, k.ordinal_position,
            k.referenced_table_schema, k.referenced_table_name, k.referenced_column_name,
            r.delete_rule, r.update_rule
       from information_schema.key_column_usage k
       join information_schema.referential_constraints r
         on r.constraint_schema = k.constraint_schema
        and r.constraint_name = k.constraint_name
        and r.table_name = k.table_name
      where k.table_schema = ?
        and k.referenced_table_name is not null
      order by k.table_name, k.constraint_name, k.ordinal_position`,
    [target],
  );

  const byTable = new Map<string, Column[]>();
  for (const c of columns) {
    const key = String(c.table_name);
    const list = byTable.get(key) ?? [];
    list.push({
      name: String(c.column_name),
      type: String(c.column_type),
      nullable: String(c.is_nullable).toUpperCase() === "YES",
      default: c.column_default === null || c.column_default === undefined ? null : String(c.column_default),
      pk: String(c.column_key ?? "").toUpperCase() === "PRI",
      position: Number(c.ordinal_position),
    });
    byTable.set(key, list);
  }

  const fksByTable = new Map<string, ForeignKey[]>();
  for (const f of foreignKeys) {
    const tableName = String(f.table_name);
    const list = fksByTable.get(tableName) ?? [];
    const name = String(f.constraint_name);
    let fk = list.find((existing) => existing.name === name);
    if (!fk) {
      fk = {
        name,
        columns: [],
        refSchema: String(f.referenced_table_schema ?? target),
        refTable: String(f.referenced_table_name),
        refColumns: [],
        onDelete: String(f.delete_rule ?? "NO ACTION").toUpperCase(),
        onUpdate: String(f.update_rule ?? "NO ACTION").toUpperCase(),
      };
      list.push(fk);
    }
    fk.columns.push(String(f.column_name));
    fk.refColumns.push(String(f.referenced_column_name));
    fksByTable.set(tableName, list);
  }

  const schema: Schema = { name: target, tables: [] };
  for (const t of tables) {
    const name = String(t.table_name);
    const type = String(t.table_type ?? "").toUpperCase();
    const table: Table = {
      schema: target,
      name,
      kind: type.includes("VIEW") ? "view" : "table",
      columns: byTable.get(name) ?? [],
      foreignKeys: fksByTable.get(name) ?? [],
    };
    const estimate = t.table_rows === null || t.table_rows === undefined ? Number.NaN : Number(t.table_rows);
    if (Number.isFinite(estimate) && estimate >= 0) table.rowEstimate = estimate;
    schema.tables.push(table);
  }

  return { database: target, schemas: [schema], fetchedAt: new Date().toISOString() };
}
