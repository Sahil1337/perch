// FROM: one card per source, side by side, before anything has been joined or filtered.

import { sourceTitle } from "../../steps";
import { colsOf, positional, rowsOf, visibleIndices } from "../columns";
import type { SceneContext } from "../context";
import { countValue, errorOf, okResult } from "../results";
import type { Scene, TableView } from "../types";
import { tables } from "../view";

export function fromScene(ctx: SceneContext): Scene {
  const { result, sources, own } = ctx;
  const list = sources.map((source, s): TableView => {
    const sample = okResult(result, `src${s}.sample`);
    const total = countValue(result, `src${s}.count`);
    const title = sourceTitle(source);
    const key = s === 0 ? "main" : `src${s}`;
    if (!sample) {
      return {
        key,
        title,
        cols: [],
        rows: [],
        source,
        total,
        error: errorOf(result, `src${s}.sample`) ?? undefined,
      };
    }
    const indices = visibleIndices(sample);
    const cols = colsOf(sample, indices, positional);
    return {
      key,
      title,
      cols,
      rows: rowsOf(sample, cols, indices, s === 0 ? "m:" : `r${s}:`),
      total,
      truncated: sample.truncated,
      source,
    };
  });
  return tables(list, own, false);
}
