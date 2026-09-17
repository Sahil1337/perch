// Where a result column comes from. pg reports each field's `tableID` (the relation oid, 0 for an
// expression) and `columnID` (attnum) but never the names, so the driver resolves them with one
// query per statement and remembers the answer for the connection's lifetime: a repeated run
// then costs nothing. Best-effort throughout — a failed lookup only means columns without a
// `source`.

import type pg from "pg";
import type { ResultColumn } from "@perch/protocol";
import { toResultColumn } from "./types.js";

export type ColumnSource = NonNullable<ResultColumn["source"]>;

/** Runs one parameterised query; a pool's `query` or a client's, whichever is free. */
export type Querier = (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>;

type Key = `${number}:${number}`;

export class ColumnSourceCache {
  /** Relation oids are per database, so one map each, keyed by the database name. */
  readonly #byDatabase = new Map<string, Map<Key, ColumnSource>>();

  /** Maps the fields to result columns, with `source` filled in wherever pg named a base table. */
  async resolve(database: string, fields: pg.FieldDef[], query: Querier): Promise<ResultColumn[]> {
    const columns = fields.map(toResultColumn);
    const wanted = fields.filter((field) => field.tableID !== 0 && field.columnID > 0);
    if (wanted.length === 0) return columns;

    const cache = this.#cacheFor(database);
    const missing = [...new Set(wanted.filter((f) => !cache.has(keyOf(f))).map(keyOf))];
    if (missing.length > 0) await lookup(missing, query, cache);

    fields.forEach((field, i) => {
      const source = field.tableID === 0 ? undefined : cache.get(keyOf(field));
      if (source) columns[i] = { ...columns[i]!, source };
    });
    return columns;
  }

  #cacheFor(database: string): Map<Key, ColumnSource> {
    let cache = this.#byDatabase.get(database);
    if (!cache) {
      cache = new Map();
      this.#byDatabase.set(database, cache);
    }
    return cache;
  }
}

const keyOf = (field: pg.FieldDef): Key => `${field.tableID}:${field.columnID}`;

type Named = {
  attrelid: number | string;
  attnum: number | string;
  relname: string;
  attname: string;
};

async function lookup(keys: Key[], query: Querier, into: Map<Key, ColumnSource>): Promise<void> {
  const values: number[] = [];
  const tuples = keys.map((key) => {
    const [oid, attnum] = key.split(":").map(Number) as [number, number];
    values.push(oid, attnum);
    return `($${values.length - 1}::oid, $${values.length}::int2)`;
  });
  try {
    const res = await query(
      `select attrelid, attnum, relname, attname from pg_attribute
       join pg_class on pg_class.oid = attrelid
       where (attrelid, attnum) in (${tuples.join(", ")})`,
      values,
    );
    for (const row of res.rows as Named[]) {
      into.set(`${Number(row.attrelid)}:${Number(row.attnum)}`, {
        table: row.relname,
        column: row.attname,
      });
    }
  } catch {
    /* a dropped table or a permission gap: the columns simply go out without a source */
  }
}
