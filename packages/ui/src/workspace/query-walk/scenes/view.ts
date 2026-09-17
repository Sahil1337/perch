// Assembling a scene out of cards: the two constructors every station builder reaches for, and the
// width cap that runs over whatever they return.

import type { StatementResult } from "@perch/protocol";
import { colsOf, positional, rowsOf, visibleIndices } from "./columns";
import type { Col, Scene, TableView } from "./types";

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
  /**
   * What the cap keeps first: the columns the station is about — a join key, a sort key, the ones a
   * WHERE names, all of which arrive already lit — then ordinary columns, and a column already known
   * to be on its way out last of all. Folding a survivor away to make room for one that is about to
   * be dropped would hide the only part of the card that outlives this station.
   */
  const rank = (col: Col): number => (col.hl || col.sort ? 0 : col.drop ? 2 : 1);
  const order = view.cols.map((col, i) => [rank(col), i] as const);
  const keep = new Set(
    order
      .slice()
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, MAX_COLS)
      .map(([, i]) => i),
  );
  return {
    ...view,
    cols: view.cols.filter((_, i) => keep.has(i)),
    hidden: view.cols.flatMap((col, i) => (keep.has(i) ? [] : [col.label])),
  };
}
