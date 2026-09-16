// DISTINCT: every row judged first-of-its-kind or repeat, then only the firsts.

import { colsOf, hashCells, positional, rowsOf, visibleIndices } from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type Row, type Scene } from "../types";
import { plain, tables } from "../view";

export function distinctScene(ctx: SceneContext): Scene {
  const { phase, result, input, own, prevSample } = ctx;
  const distinct = okResult(result, "sample");
  if (!distinct) return EMPTY;
  if (phase === 0 && prevSample) {
    const indices = visibleIndices(prevSample);
    const cols = colsOf(prevSample, indices, positional);
    const seen = new Set<string>();
    const rows = rowsOf(prevSample, cols, indices, "m:").map((row, i): Row => {
      const hash = hashCells(prevSample.rows[i]!, indices);
      const first = !seen.has(hash);
      seen.add(hash);
      return { ...row, verdict: first ? "pass" : "fail", testIndex: i };
    });
    return tables([{ key: "main", title: "result", cols, rows }], input);
  }
  return tables([plain("main", "result", distinct, own)], own);
}
