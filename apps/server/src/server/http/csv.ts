// RFC 4180 CSV writer. Shared by the /export route and the CLI's --format csv.

import type { Cell, Row } from "@perch/protocol";

const NEEDS_QUOTES = /[",\r\n]/;

/** Renders one cell as CSV text (RFC 4180 §2.5/2.6/2.7). `null`/`undefined` become empty. */
export function csvCell(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  if (!NEEDS_QUOTES.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Renders one record (no line terminator). */
export function csvRow(cells: readonly (Cell | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

export type CsvOptions = {
  /** Record separator. RFC 4180 says CRLF; override for terminal output. */
  eol?: string;
  /** Emit a terminator after the last record too. Default true. */
  trailingEol?: boolean;
};

/** Renders a header row plus data rows. */
export function toCsv(
  columns: readonly string[],
  rows: readonly Row[],
  opts: CsvOptions = {},
): string {
  const eol = opts.eol ?? "\r\n";
  const trailing = opts.trailingEol ?? true;
  const lines: string[] = [];
  if (columns.length > 0) lines.push(csvRow(columns));
  for (const row of rows) lines.push(csvRow(row));
  if (lines.length === 0) return "";
  return lines.join(eol) + (trailing ? eol : "");
}
