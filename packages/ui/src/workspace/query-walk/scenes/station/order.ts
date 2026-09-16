// ORDER BY: the same rows before and after the sort, with the sort keys lit and arrowed, so the
// only thing that moves is the rows.

import type { StatementResult } from "@perch/protocol";
import { colsOf, findColumn, positional, rowsOf, visibleIndices } from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type Col, type Scene } from "../types";
import { tables } from "../view";

export function orderScene(ctx: SceneContext): Scene {
  const { walk, phase, result, tableOf, own, prevSample } = ctx;
  const { parsed } = walk;
  const ordered = okResult(result, "sample");
  if (!ordered) return EMPTY;
  const sortCols = (sample: StatementResult, indices: number[]): Col[] =>
    colsOf(sample, indices, positional).map((col, at) => {
      const index = indices[at]!;
      const item = parsed.orderItems.find((entry) => {
        const expr = entry.expr.trim();
        if (/^\d+$/.test(expr)) return Number(expr) - 1 === index;
        const found = findColumn(sample, indices, expr, tableOf);
        // An expression names no column: light the output column in the same position.
        return found !== null ? found === index : parsed.selectItems[index] === expr;
      });
      // `+14`: the sort arrow shares the header cell, and without the room it eats the name.
      return item
        ? { ...col, width: col.width + 14, hl: true, sort: item.desc ? "desc" : "asc" }
        : col;
    });
  const source = phase === 0 ? (prevSample ?? ordered) : ordered;
  const indices = visibleIndices(source);
  const cols = sortCols(source, indices);
  return tables(
    [
      {
        key: "main",
        title: "result",
        cols,
        rows: rowsOf(source, cols, indices, "m:"),
        total: own,
        truncated: source.truncated,
      },
    ],
    own,
  );
}
