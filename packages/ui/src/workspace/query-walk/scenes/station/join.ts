// JOIN: the two sides lit on their keys, then the paired rows with the unmatched ones marked, then
// the joined table on its own.

import type { StatementResult } from "@perch/protocol";
import type { KeyPair } from "../../clauses";
import { sourceTitle } from "../../steps";
import { colsOf, findColumn, positional, rowsOf, visibleIndices, withHl } from "../columns";
import type { SceneContext } from "../context";
import { countValue, joinKeys, okResult } from "../results";
import { EMPTY, type Scene, type TableView } from "../types";
import { plain, tables } from "../view";

export function joinScene(ctx: SceneContext): Scene {
  const { walk, index, phase, station, result, sample: joined, tableOf, chainTitle, input, own, prevSample } =
    ctx;
  const join = station.join!;
  const j = station.joinIndex;
  // A natural join names no columns, so these are the ones it was found to share. Null means the
  // sides have not both landed; nothing is lit until they have, which is what was on screen anyway.
  const keys = joinKeys(walk, index, station) ?? [];
  if (!joined) return EMPTY;
  const right = okResult(walk.results[0], `src${j + 1}.sample`);
  const left = prevSample;
  const leftCount = left
    ? left.columns.length
    : right
      ? joined.columns.length - right.columns.length
      : joined.columns.length;
  const all = joined.columns.map((_, i) => i);
  const leftIdx = all.slice(0, leftCount);
  const rightIdx = all.slice(leftCount);
  const keyIds = (
    sample: StatementResult,
    indices: number[],
    refs: (pair: KeyPair) => string,
  ): Set<string> =>
    new Set(
      keys.flatMap((pair) => {
        const found = findColumn(sample, indices, refs(pair), tableOf);
        return found === null ? [] : [positional(found)];
      }),
    );
  const title = chainTitle(j + 1);

  if (phase === 0 && left) {
    const leftVisible = visibleIndices(left);
    const leftCols = withHl(
      colsOf(left, leftVisible, positional),
      keyIds(left, leftVisible, (pair) => pair.left),
    );
    const main: TableView = {
      key: "main",
      title: chainTitle(j),
      cols: leftCols,
      rows: rowsOf(left, leftCols, leftVisible, "m:"),
    };
    if (!right) return tables([main], input);
    const rightVisible = visibleIndices(right);
    const rightCols = withHl(
      colsOf(right, rightVisible, positional),
      keyIds(right, rightVisible, (pair) => pair.right),
    );
    const side: TableView = {
      key: `src${j + 1}`,
      title: sourceTitle(join.source),
      cols: rightCols,
      rows: rowsOf(right, rightCols, rightVisible, `r${j + 1}:`),
      total: countValue(walk.results[0], `src${j + 1}.count`),
    };
    return tables([main, side], input);
  }

  const visible = visibleIndices(joined);
  const lit = new Set([
    ...keyIds(joined, leftIdx, (pair) => pair.left),
    ...keyIds(joined, rightIdx, (pair) => pair.right),
  ]);
  if (phase <= 1) {
    const pairs = okResult(result, "pairs");
    const source = pairs ?? joined;
    const cols = withHl(colsOf(source, visible, positional), lit);
    const rows = rowsOf(source, cols, visible, "m:", leftIdx).map((row, i) => {
      const raw = source.rows[i]!;
      const unmatched =
        pairs !== null && rightIdx.length > 0 && rightIdx.every((k) => raw[k] === null);
      return unmatched ? { ...row, verdict: "fail" as const, testIndex: 0 } : row;
    });
    return tables([{ key: "main", title, cols, rows }], input);
  }
  return tables([plain("main", title, joined, own, leftIdx)], own);
}
