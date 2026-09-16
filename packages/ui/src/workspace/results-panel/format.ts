import type { StatementResult } from "@perch/protocol";
import type { Run } from "../types";

export function isRowResult(result: StatementResult): boolean {
  return result.columns.length > 0;
}

export function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** psql's wording: the verb, then what it touched. */
export function commandLabel(result: StatementResult): string {
  const command = result.command ?? "OK";
  return result.affectedRows === null ? command : `${command} ${result.affectedRows}`;
}

/** What a statement tab says: `30 rows · 142ms` for a result set, `DELETE 412` for everything else. */
export function statementSummary(result: StatementResult): string {
  return isRowResult(result)
    ? `${plural(result.rowCount, "row")} · ${result.durationMs}ms`
    : commandLabel(result);
}

export function clockOf(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString("en-GB", { hour12: false });
}

/** The one line the pane tab cannot carry: what came back. */
export function summaryOf(
  run: Run | undefined,
  statement: StatementResult | undefined,
): string | null {
  if (!run) return null;
  if (run.status === "running") return "Running…";
  if (run.status === "cancelled") return "Cancelled";
  if (statement) return statementSummary(statement);
  return run.status === "error" ? "Failed" : null;
}

/**
 * A bar's share of its cell — ragged, but derived from the coordinates rather than `Math.random`, so
 * a re-render cannot reshuffle every width mid-shimmer and the server render agrees with the client.
 */
export function barWidth(row: number, column: number, base: number, spread: number): string {
  const noise = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453;
  return `${Math.round(base + (noise - Math.floor(noise)) * spread)}%`;
}
