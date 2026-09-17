// GROUP BY: the rows before grouping with the key columns lit, then those same rows gathered into
// buckets, then the buckets squashed down to the one row each becomes.

import type { StatementResult } from "@perch/protocol";
import { formatCell } from "../../../results-grid";
import { WALK_PREFIX } from "../../steps";
import {
  colsOf,
  findColumn,
  hashCells,
  isNumeric,
  positional,
  rowsOf,
  visibleIndices,
  withHl,
} from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type BucketView, type Row, type Scene, type Summary } from "../types";
import { plain, tables } from "../view";

export function groupScene(ctx: SceneContext): Scene {
  const { parsed, phase, result, sample: grouped, tableOf, input, own, prevSample, mainTitle } = ctx;
  if (!grouped) return EMPTY;
  const pre = okResult(result, "pre");
  const keyIndicesOf = (sample: StatementResult): number[] =>
    sample.columns.flatMap((column, i) => (column.name.startsWith(`${WALK_PREFIX}k`) ? [i] : []));
  const groupedVisible = visibleIndices(grouped);
  const groupedTable = (): Scene => tables([plain("main", "groups", grouped, own)], own);
  if (!pre) {
    if (phase === 0 && prevSample)
      return tables([plain("main", mainTitle, prevSample, input)], input);
    return groupedTable();
  }

  const preVisible = visibleIndices(pre);
  const preKeys = keyIndicesOf(pre);
  // Plain-column keys light their column; an expression key has no column to light.
  const litKeys = new Set(
    parsed.groupKeys.flatMap((key) => {
      const found = findColumn(pre, preVisible, key, tableOf);
      return found === null ? [] : [positional(found)];
    }),
  );
  const preCols = withHl(colsOf(pre, preVisible, positional), litKeys);
  const preRows = rowsOf(pre, preCols, preVisible, "m:").map((row) => ({
    ...row,
    hl: [...litKeys],
  }));
  if (phase === 0) {
    return tables([{ key: "main", title: mainTitle, cols: preCols, rows: preRows }], input);
  }

  const groupedKeys = keyIndicesOf(grouped);
  const summaries = new Map<string, Summary[]>();
  for (const row of grouped.rows) {
    summaries.set(
      hashCells(row, groupedKeys),
      groupedVisible.map((i) => ({
        label: grouped.columns[i]!.name,
        value: row[i] ?? null,
        num: isNumeric(grouped.columns[i]!),
      })),
    );
  }
  const buckets: BucketView[] = [];
  const byKey = new Map<string, { members: Row[]; count: number }>();
  pre.rows.forEach((raw, i) => {
    const hash = hashCells(raw, preKeys);
    let bucket = byKey.get(hash);
    if (!bucket) {
      bucket = { members: [], count: 0 };
      byKey.set(hash, bucket);
      buckets.push({
        key: `g:${hash}`,
        title: preKeys.map((k) => formatCell(raw[k] ?? null)).join(" · "),
        members: bucket.members,
        count: 0,
        summary: summaries.get(hash) ?? null,
      });
    }
    bucket.members.push(preRows[i]!);
    bucket.count += 1;
  });
  const counted = buckets.map((bucket) => ({ ...bucket, count: bucket.members.length }));
  const memberCols = [
    ...preCols.filter((col) => !litKeys.has(col.id)),
    ...preCols.filter((col) => litKeys.has(col.id)),
  ].slice(0, 3);
  const squash = phase >= 2;
  return { kind: "buckets", buckets: counted, memberCols, squash, count: squash ? own : input };
}
