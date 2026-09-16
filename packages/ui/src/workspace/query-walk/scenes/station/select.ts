// SELECT: the earlier rows narrowed to the columns the list keeps, then the output columns in the
// list's own order, each carrying the key of the row it came from so nothing re-enters.

import { colsOf, positional, rowsOf, visibleIndices } from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type Scene } from "../types";
import { plain, tables } from "../view";

export function selectScene(ctx: SceneContext): Scene {
  const { phase, result, own, prevSample, mainTitle } = ctx;
  const output = okResult(result, "sample");
  if (!output) return EMPTY;
  const outVisible = visibleIndices(output);
  if (!prevSample) return tables([plain("main", "result", output, own)], own);
  const prevVisible = visibleIndices(prevSample);
  // Which earlier column each output column comes from: by driver-reported source, else by name.
  const taken = new Set<number>();
  const origin = new Map<number, number>();
  for (const j of outVisible) {
    const column = output.columns[j]!;
    const match = prevVisible.find((i) => {
      if (taken.has(i)) return false;
      const candidate = prevSample.columns[i]!;
      if (column.source && candidate.source) {
        return (
          column.source.table === candidate.source.table &&
          column.source.column === candidate.source.column
        );
      }
      return candidate.name.toLowerCase() === column.name.toLowerCase();
    });
    if (match !== undefined) {
      taken.add(match);
      origin.set(j, match);
    }
  }
  if (phase === 0) {
    const kept = prevVisible.filter((i) => taken.has(i));
    const cols = colsOf(prevSample, kept, positional);
    return tables(
      [{ key: "main", title: mainTitle, cols, rows: rowsOf(prevSample, cols, kept, "m:", prevVisible) }],
      own,
    );
  }
  const prevRows = rowsOf(prevSample, colsOf(prevSample, prevVisible, positional), prevVisible, "m:");
  const cols = colsOf(output, outVisible, (j) => {
    const from = origin.get(j);
    return from === undefined ? `n${j}` : positional(from);
  });
  const rows = rowsOf(output, cols, outVisible, "m:").map((row, i) =>
    prevRows[i] ? { ...row, key: prevRows[i]!.key } : row,
  );
  return tables([{ key: "main", title: "result", cols, rows, total: own, truncated: output.truncated }], own);
}
