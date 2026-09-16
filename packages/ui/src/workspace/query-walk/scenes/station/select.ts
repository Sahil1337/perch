// SELECT: the earlier rows narrowed to the columns the list keeps, then the output columns in the
// list's own order, each carrying the key of the row it came from so nothing re-enters — and, when
// the list holds a CASE, one more column saying which of its branches each row took.

import type { StatementResult } from "@perch/protocol";
import { branchColumn, caseExpressions } from "../../steps";
import { colsOf, hashCells, positional, rowsOf, truthy, visibleIndices, widthFor } from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type Col, type Row, type Scene } from "../types";
import { plain, tables } from "../view";

/** The id of the column the CASE phase adds. Not a column of the query, so it has no position. */
const BRANCH = "branch";

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
  const branches = phase >= 2 ? withBranches(ctx, output, outVisible, rows) : null;
  return tables(
    [
      {
        key: "main",
        title: "result",
        cols: branches ? [...cols, branches.col] : cols,
        rows: branches ? branches.rows : rows,
        total: own,
        truncated: output.truncated,
      },
    ],
    own,
  );
}

/**
 * The branch each row took, as one more column beside the answer the CASE already shows.
 *
 * The branch probe is a second run of the same unordered query, so its rows are matched back to
 * the output's by what is in them rather than by position — two runs of one query are not promised
 * to come back in the same order, and a row wearing another row's branch would be a lie told
 * confidently. Identical rows queue up behind their shared hash and are handed out in turn.
 */
function withBranches(
  ctx: SceneContext,
  output: StatementResult,
  outVisible: readonly number[],
  rows: readonly Row[],
): { readonly col: Col; readonly rows: readonly Row[] } | null {
  const expression = caseExpressions(ctx.walk.parsed)[0];
  const sample = okResult(ctx.result, "case");
  if (!expression || !sample) return null;
  const visible = visibleIndices(sample);
  const tests = expression.branches.map((_, index) =>
    sample.columns.findIndex((column) => column.name === branchColumn(index)),
  );
  if (tests.some((index) => index < 0)) return null;

  const queued = new Map<string, string[]>();
  for (const raw of sample.rows) {
    const won = tests.findIndex((index) => truthy(raw[index]));
    const label =
      won >= 0
        ? `when ${expression.branches[won]!.when}`
        : expression.fallback !== null
          ? `else ${expression.fallback}`
          : "no branch: null";
    const hash = hashCells(raw, visible);
    const queue = queued.get(hash);
    if (queue) queue.push(label);
    else queued.set(hash, [label]);
  }

  const labels = output.rows.map((raw) => queued.get(hashCells(raw, outVisible))?.shift() ?? null);
  return {
    col: { id: BRANCH, label: "branch taken", width: widthFor("branch taken", labels), num: false, hl: true },
    rows: rows.map((row, i) => ({ ...row, cells: { ...row.cells, [BRANCH]: labels[i] ?? null } })),
  };
}
