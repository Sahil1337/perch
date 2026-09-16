// LIMIT / OFFSET: the rows the offset skips marked and a cut line where the limit falls, then what
// is left.

import { colsOf, positional, rowsOf, visibleIndices } from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type Row, type Scene } from "../types";
import { plain, tables } from "../view";

export function limitScene(ctx: SceneContext): Scene {
  const { walk, phase, result, input, own, prevSample } = ctx;
  const { parsed } = walk;
  const final = okResult(result, "sample");
  if (!final) return EMPTY;
  const { limitValue, offsetValue } = parsed;
  const offset = offsetValue ?? 0;
  const label = [
    limitValue !== null ? `LIMIT ${limitValue}` : null,
    offsetValue !== null ? `OFFSET ${offsetValue}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (phase === 0 && prevSample) {
    const indices = visibleIndices(prevSample);
    const cols = colsOf(prevSample, indices, positional);
    const rows = rowsOf(prevSample, cols, indices, "m:").map(
      (row, i): Row => (i < offset ? { ...row, verdict: "fail", testIndex: 0 } : row),
    );
    const cutAt = limitValue === null ? null : offset + limitValue;
    const cut =
      cutAt !== null && cutAt < rows.length ? { after: cutAt, label: `${label} · cut here` } : undefined;
    return tables([{ key: "main", title: "result", cols, rows, cut }], input);
  }
  return tables([plain("main", "result", final, own)], own);
}
