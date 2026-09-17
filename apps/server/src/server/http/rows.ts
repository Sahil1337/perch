// Zipping a result's columns onto its rows. Both JSON-shaped outputs need it — the run export
// endpoint and the CLI's `--format json|ndjson` — and they have to agree on the answer.

import type { Cell, ResultColumn, Row } from "@perch/protocol";

/** Rows as an array of `{ column: value }` objects, in column order. */
export function rowsToObjects(columns: ResultColumn[], rows: Row[]): Record<string, Cell>[] {
  return rows.map((row) => {
    const obj: Record<string, Cell> = {};
    columns.forEach((column, i) => {
      obj[column.name] = row[i] ?? null;
    });
    return obj;
  });
}
