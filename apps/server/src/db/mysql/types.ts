// Value and error mapping for the MySQL driver: mysql2 type code → name, value → wire Cell,
// mysql2 error → QueryError, and the command tag MySQL itself never sends back.
// The value → Cell mapping itself is dialect-agnostic and lives in ../cell.ts.

import mysql from "mysql2/promise";
import type { FieldPacket } from "mysql2";
import { type QueryError, type ResultColumn } from "@perch/protocol";
import { stripLeadingNoise } from "../../core/sql/lead.js";

/** Numeric column types get right-aligned, as do dates/times. Names come from mysql2's Types map. */
const RIGHT_ALIGNED = new Set([
  "decimal",
  "newdecimal",
  "tiny",
  "short",
  "long",
  "longlong",
  "int24",
  "float",
  "double",
  "year",
  "bit",
  "date",
  "newdate",
  "datetime",
  "timestamp",
  "time",
]);

/** mysql2 exposes its type constants as a numeric-keyed map (3 -> "LONG"). */
export function mysqlTypeName(code: number | undefined): string {
  if (code === undefined || code === null) return "unknown";
  const name = (mysql.Types as unknown as Record<number, string | undefined>)[code];
  return name ? name.toLowerCase() : `type:${code}`;
}

export function toResultColumn(field: FieldPacket): ResultColumn {
  const type = mysqlTypeName(field.columnType ?? field.type);
  const column: ResultColumn = {
    name: field.name,
    type,
    align: RIGHT_ALIGNED.has(type) ? "right" : "left",
  };
  // mysql2 reports the base table and column behind an alias; both are "" for an expression.
  const { orgTable, orgName } = field;
  if (
    typeof orgTable === "string" &&
    orgTable !== "" &&
    typeof orgName === "string" &&
    orgName !== ""
  ) {
    column.source = { table: orgTable, column: orgName };
  }
  return column;
}

const TWO_WORD_COMMANDS = new Set(["create", "drop", "alter", "rename", "truncate", "show"]);

/** MySQL has no command tag, so derive one ("INSERT", "CREATE TABLE") from the statement text. */
export function commandOf(sql: string): string | null {
  const head = stripLeadingNoise(sql);
  const words = head.split(/\s+/, 2);
  const first = words[0]?.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!first) return null;
  if (TWO_WORD_COMMANDS.has(first)) {
    const second = words[1]?.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (second) return `${first.toUpperCase()} ${second.toUpperCase()}`;
  }
  return first.toUpperCase();
}

export type MysqlError = Error & {
  code?: string;
  errno?: number;
  sqlMessage?: string;
  sqlState?: string;
};

export function toQueryError(err: unknown, statementSql: string): QueryError {
  const e = err as MysqlError;
  const out: QueryError = { message: e?.sqlMessage ?? e?.message ?? String(err) };
  if (e?.code) out.code = e.code;
  if (e?.sqlState) out.detail = `SQLSTATE ${e.sqlState}`;
  // MySQL reports no character position, but parse errors carry "... at line N".
  const line = /at line (\d+)/i.exec(out.message)?.[1];
  if (line) {
    const n = Number.parseInt(line, 10);
    if (Number.isFinite(n) && n > 0) {
      out.line = n;
      out.position = offsetOfLine(statementSql, n);
    }
  }
  return out;
}

function offsetOfLine(sql: string, line: number): number {
  let offset = 0;
  for (let n = 1; n < line; n++) {
    const nl = sql.indexOf("\n", offset);
    if (nl === -1) return offset;
    offset = nl + 1;
  }
  return offset;
}
