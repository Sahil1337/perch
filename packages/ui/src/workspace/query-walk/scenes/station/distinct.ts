// DISTINCT: every row judged first-of-its-kind or repeat, then only the firsts.

import { hashCells } from "../columns";
import type { SceneContext } from "../context";
import { EMPTY, type Row, type Scene } from "../types";
import { plain, snapshot, tables } from "../view";

export function distinctScene(ctx: SceneContext): Scene {
  const { phase, sample: distinct, input, own, prevSample } = ctx;
  if (!distinct) return EMPTY;
  if (phase === 0 && prevSample) {
    const { indices, cols, rows: before } = snapshot(prevSample);
    const seen = new Set<string>();
    const rows = before.map((row, i): Row => {
      const hash = hashCells(prevSample.rows[i]!, indices);
      const first = !seen.has(hash);
      seen.add(hash);
      return { ...row, verdict: first ? "pass" : "fail", testIndex: i };
    });
    return tables([{ key: "main", title: "result", cols, rows }], input);
  }
  return tables([plain("main", "result", distinct, own)], own);
}
