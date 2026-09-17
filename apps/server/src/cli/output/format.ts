// Output formatters for `perch run` (table/csv/json/ndjson). CSV is not written here: the RFC 4180
// writer in server/http/csv.ts is the only one in the package, and `cli -> server` is a legal
// import direction, so this just points `--format csv` at it with terminal-friendly options.
// `--format json|ndjson` reaches the same way for the column/row zip the run export also uses.

import type { Cell, ResultColumn, Row } from "@perch/protocol";
import { toCsv } from "../../server/http/csv.js";
import { rowsToObjects } from "../../server/http/rows.js";

export type OutputFormat = "table" | "json" | "csv" | "ndjson";

function cellText(v: Cell): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "t" : "f";
  return String(v);
}

/** Aligned, whitespace-padded table with a header row and a `-+-` separator, psql-ish. */
export function formatTable(columns: ResultColumn[], rows: Row[]): string {
  if (columns.length === 0) return "(no columns)";
  const widths = columns.map((c, i) =>
    Math.max(c.name.length, ...rows.map((r) => cellText(r[i] ?? null).length)),
  );
  const pad = (s: string, w: number, align: "left" | "right"): string =>
    align === "right" ? s.padStart(w) : s.padEnd(w);
  const headerLine = columns.map((c, i) => pad(c.name, widths[i]!, c.align)).join(" | ");
  const sepLine = widths.map((w) => "-".repeat(w)).join("-+-");
  const rowLines = rows.map((r) =>
    columns.map((c, i) => pad(cellText(r[i] ?? null), widths[i]!, c.align)).join(" | "),
  );
  return [headerLine, sepLine, ...rowLines].join("\n");
}

/** RFC 4180 CSV: header row + one row per data row, CRLF separated, no trailing newline. */
export function formatCsv(columns: ResultColumn[], rows: Row[]): string {
  return toCsv(
    columns.map((c) => c.name),
    rows,
    { trailingEol: false },
  );
}

/** Pretty-printed JSON array of row objects. */
export function formatJson(columns: ResultColumn[], rows: Row[]): string {
  return JSON.stringify(rowsToObjects(columns, rows), null, 2);
}

/** One compact JSON object per line, no trailing newline. */
export function formatNdjson(columns: ResultColumn[], rows: Row[]): string {
  return rowsToObjects(columns, rows)
    .map((o) => JSON.stringify(o))
    .join("\n");
}

export function format(kind: OutputFormat, columns: ResultColumn[], rows: Row[]): string {
  switch (kind) {
    case "json":
      return formatJson(columns, rows);
    case "csv":
      return formatCsv(columns, rows);
    case "ndjson":
      return formatNdjson(columns, rows);
    case "table":
    default:
      return formatTable(columns, rows);
  }
}

/** The "N rows · T ms" footer printed under table-format results. */
export function footer(rowCount: number, durationMs: number, truncated = false): string {
  const rows = `${rowCount} row${rowCount === 1 ? "" : "s"}`;
  return truncated ? `${rows} · ${durationMs} ms (truncated)` : `${rows} · ${durationMs} ms`;
}
