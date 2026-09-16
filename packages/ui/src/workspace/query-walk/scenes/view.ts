// Assembling a scene out of cards: the two constructors every station builder reaches for, and the
// width cap that runs over whatever they return.

import type { StatementResult } from "@perch/protocol";
import { colsOf, positional, rowsOf, visibleIndices } from "./columns";
import type { Scene, TableView } from "./types";

export const tables = (list: TableView[], count: number | null, tight = true): Scene => ({
  kind: "tables",
  tables: list,
  tight,
  count,
});

export const plain = (
  key: string,
  title: string,
  sample: StatementResult,
  total: number | null,
  keyIndices?: readonly number[],
): TableView => {
  const indices = visibleIndices(sample);
  const cols = colsOf(sample, indices, positional);
  return {
    key,
    title,
    cols,
    rows: rowsOf(sample, cols, indices, "m:", keyIndices),
    total,
    truncated: sample.truncated,
  };
};

/** Columns one card shows before the rest fold into a single `+n` marker. */
const MAX_COLS = 8;

/**
 * A card wider than this is unreadable and shoves the next one off the stage, so it keeps the
 * columns the station is actually about — a join key, a sort key, the ones a WHERE names, all of
 * which arrive already lit — and then the leftmost of the rest, in the query's own order.
 */
export function capCols(view: TableView): TableView {
  // One folded column is not worth the marker that replaces it.
  if (view.cols.length <= MAX_COLS + 1) return view;
  const lit = view.cols.flatMap((col, i) => (col.hl || col.sort ? [i] : []));
  const rest = view.cols.flatMap((col, i) => (col.hl || col.sort ? [] : [i]));
  const keep = new Set([...lit, ...rest].slice(0, MAX_COLS));
  return {
    ...view,
    cols: view.cols.filter((_, i) => keep.has(i)),
    hidden: view.cols.flatMap((col, i) => (keep.has(i) ? [] : [col.label])),
  };
}
