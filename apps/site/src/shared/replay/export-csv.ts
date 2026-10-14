import type { Cell, StatementResult } from "@perch/protocol";

/**
 * One statement's rows as the server's CSV export writes them (apps/server/server/runs.go): a
 * header of column names, a null as an empty field, quoted only where a field needs it. A data:
 * URL rather than a blob, because `exportUrl` is read during render and a blob would leak per paint.
 */
export function exportCsvUrl(result: StatementResult): string {
  const lines = [result.columns.map((column) => field(column.name))];
  for (const row of result.rows) lines.push(result.columns.map((_, i) => field(text(row[i] ?? null))));
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`${lines.map((l) => l.join(",")).join("\n")}\n`)}`;
}

function text(cell: Cell): string {
  return cell === null ? "" : String(cell);
}

/** Go's encoding/csv rule: quote a field holding a comma, quote, CR or LF, or a leading space. */
function field(value: string): string {
  if (value === "" || !/[",\r\n]|^\s/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
