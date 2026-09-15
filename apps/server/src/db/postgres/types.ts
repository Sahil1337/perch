// Value and error mapping for the PostgreSQL driver: OID → type name, pg value → wire Cell,
// pg error → QueryError, and the heuristic that decides whether a statement returns rows.

import type pg from "pg";
import { type Cell, type QueryError, type ResultColumn, type Row } from "@perch/protocol";

/** Builtin OIDs worth naming; anything else is reported as `oid:<n>`. */
const OID_NAMES: Record<number, string> = {
  16: "bool",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  114: "json",
  700: "float4",
  701: "float8",
  1042: "bpchar",
  1043: "varchar",
  1082: "date",
  1083: "time",
  1114: "timestamp",
  1184: "timestamptz",
  1186: "interval",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
};

const RIGHT_ALIGNED = new Set([
  "int2",
  "int4",
  "int8",
  "float4",
  "float8",
  "numeric",
  "date",
  "time",
  "timestamp",
  "timestamptz",
]);

export function pgTypeName(oid: number): string {
  return OID_NAMES[oid] ?? `oid:${oid}`;
}

export function toResultColumn(field: pg.FieldDef): ResultColumn {
  const type = pgTypeName(field.dataTypeID);
  return { name: field.name, type, align: RIGHT_ALIGNED.has(type) ? "right" : "left" };
}

/** Everything the UI can put in a cell. Dates/buffers/objects become strings. */
export function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value as Cell;
  if (t === "bigint") return (value as bigint).toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export const toRow = (row: unknown[]): Row => row.map(toCell);

function lineOfOffset(sql: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < sql.length; i++) if (sql[i] === "\n") line++;
  return line;
}

type PgError = Error & {
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
};

export function toQueryError(err: unknown, statementSql: string): QueryError {
  const e = err as PgError;
  const out: QueryError = { message: e?.message ?? String(err) };
  if (e?.code) out.code = e.code;
  if (e?.detail) out.detail = e.detail;
  if (e?.hint) out.hint = e.hint;
  const pos = e?.position ? Number.parseInt(e.position, 10) : Number.NaN;
  if (Number.isFinite(pos) && pos > 0) {
    out.position = pos - 1;
    out.line = lineOfOffset(statementSql, out.position);
  }
  return out;
}

/**
 * `true` when the statement is expected to produce a result set. Row-returning statements go
 * through a cursor; the rest through `client.query` (the extended protocol a cursor needs cannot
 * run e.g. VACUUM). If the guess is wrong for a `client.query` statement we still emit its rows,
 * so this only costs streaming, never correctness.
 */
export function looksRowReturning(sql: string): boolean {
  const head = stripLeadingNoise(sql);
  const first = /^[a-z]+/i.exec(head)?.[0]?.toLowerCase() ?? "";
  if (["select", "with", "table", "values", "show", "explain", "fetch"].includes(first)) return true;
  if (["insert", "update", "delete", "merge"].includes(first)) return /\breturning\b/i.test(sql);
  return false;
}

function stripLeadingNoise(sql: string): string {
  let i = 0;
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i]!)) i++;
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) return "";
      i = nl + 1;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return "";
      i = end + 2;
      continue;
    }
    if (sql[i] === "(") {
      i++;
      continue;
    }
    return sql.slice(i);
  }
}
