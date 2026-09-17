// LIMIT / OFFSET: the rows the offset skips marked and a cut line where the limit falls, then what
// is left.

import type { SceneContext } from "../context";
import { EMPTY, type Row, type Scene } from "../types";
import { plain, snapshot, tables } from "../view";

export function limitScene(ctx: SceneContext): Scene {
  const { parsed, phase, sample: final, input, own, prevSample } = ctx;
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
    const { cols, rows: before } = snapshot(prevSample);
    const rows = before.map((row, i): Row =>
      i < offset ? { ...row, verdict: "fail", testIndex: 0 } : row,
    );
    const cutAt = limitValue === null ? null : offset + limitValue;
    const cut =
      cutAt !== null && cutAt < rows.length
        ? { after: cutAt, label: `${label} · cut here` }
        : undefined;
    return tables([{ key: "main", title: "result", cols, rows, cut }], input);
  }
  return tables([plain("main", "result", final, own)], own);
}
