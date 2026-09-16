// The two cards a per-row section shows: every row of the outer query on the left, and the rows the
// subquery came back with for the one currently bound on the right.
//
// It is not a station, so it is not in `buildScene`'s switch — a bound section has no clauses to
// step through, and what moves here is which OUTER row is bound rather than which clause has run.
// It still speaks the stage's own vocabulary: the pass/fail mark WHERE uses for a row test is the
// same mark here, because it means the same thing — this row got through, that one did not.

import type { Cell, StatementResult } from "@perch/protocol";
import type { BoundPlan, BoundRow } from "../bound";
import { colsOf, positional, visibleIndices, widthFor } from "./columns";
import type { Col, Row, Scene, TableView } from "./types";
import { plain, tables } from "./view";

/** The match count's own column id, which no positional column can collide with. */
const MATCHES = "matches";

export function boundScene(args: {
  readonly plan: BoundPlan;
  readonly outer: StatementResult;
  readonly rows: readonly BoundRow[];
  readonly current: number;
  readonly title: string;
  readonly inner: StatementResult | null;
  readonly innerError: string | null;
}): Scene {
  const { plan, outer, rows, current, inner, innerError, title } = args;
  const indices = visibleIndices(outer);
  const counted = plan.counting !== null;
  const cols: Col[] = [
    ...colsOf(outer, indices, positional),
    ...(counted
      ? [
          {
            id: MATCHES,
            label: MATCHES,
            width: widthFor(MATCHES, rows.map((row) => row.matches)),
            num: true,
            // Lit from the start: it is the column this whole section exists to produce, and the
            // reader's eye has to land on it before the verdict beside it means anything.
            hl: true,
          },
        ]
      : []),
  ];

  const outerRows: Row[] = rows.map((row, index) => {
    const cells: Record<string, Cell> = {};
    indices.forEach((column, position) => {
      cells[cols[position]!.id] = outer.rows[index]?.[column] ?? null;
    });
    if (counted) cells[MATCHES] = row.matches;
    return {
      key: row.key,
      cells,
      verdict: row.pass ? "pass" : "fail",
      current: index === current,
    };
  });

  const outerView: TableView = {
    key: "outer",
    title: plan.outer.label,
    cols,
    rows: outerRows,
    total: outer.rowCount,
    truncated: outer.truncated,
  };

  // The inner card keeps its key across rows on purpose: the card stays put and its ROWS animate in
  // and out as the binding moves, which is the thing being taught. A fresh key per row would make
  // the whole card cross-fade and hide that the rows are what changed.
  const innerView: TableView = innerError
    ? { key: "inner", title, cols: [], rows: [], error: innerError }
    : inner
      ? plain("inner", title, inner, inner.rowCount)
      : { key: "inner", title, cols: [], rows: [] };

  return tables([outerView, innerView], inner?.rowCount ?? null, false);
}
