// WINDOW: the rows gathered into the panes PARTITION BY cuts them into, then each row handed the
// value its function computed for it.
//
// The panes borrow GROUP BY's buckets, because a pane is exactly a bucket that never squashes:
// same gathering, same header carrying the key, and `squash` left false for good so every row
// stays on screen. That is the whole lesson — GROUP BY collapses a bucket to one row, a window
// function leaves all of them standing — and it is told by the one difference between the scenes
// rather than by a sentence.

import { formatCell } from "../../../results-grid";
import { WALK_PREFIX, WINDOW_COLUMN, windowFunctions } from "../../steps";
import { colsOf, findColumn, hashCells, positional, rowsOf, visibleIndices } from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type BucketView, type Col, type Row, type Scene } from "../types";
import { plain, tables } from "../view";

/** Columns a bucket is narrow enough to show: an identity, the column the frame walks, the value. */
const MEMBER_COLS = 3;

/** `salary desc nulls last` → `salary`: the column an ORDER BY item is about, for finding it. */
const DIRECTIONS = /\s+(asc|desc)\b|\s+nulls\s+(first|last)\b/gi;

export function windowScene(ctx: SceneContext): Scene {
  const { walk, phase, result, tableOf, input, own, mainTitle } = ctx;
  const sample = okResult(result, "sample");
  if (!sample) return EMPTY;
  const count = own ?? input;
  const fn = windowFunctions(walk.parsed)[0];
  const value = sample.columns.findIndex((column) => column.name === WINDOW_COLUMN);
  // The probe asks for the function's value under a name of the walk's own, so losing it means the
  // splice came back as something else entirely; the rows are still worth showing plainly.
  if (!fn || value < 0) return tables([plain("main", mainTitle, sample, count)], count);

  const visible = visibleIndices(sample);
  const keys = sample.columns.flatMap((column, i) =>
    column.name.startsWith(`${WALK_PREFIX}k`) ? [i] : [],
  );
  const shown = [...visible, value];
  const cols: Col[] = [
    ...colsOf(sample, visible, positional),
    { ...colsOf(sample, [value], positional)[0]!, label: fn.call, hl: true },
  ];
  // Keyed on the visible cells alone, so a row carries the same key as it had at the station
  // before this one and animates across rather than re-entering.
  const rows = rowsOf(sample, cols, shown, "m:", visible);

  // A bucket is too narrow for the whole row and its header already carries the partition key, so
  // what a member shows is who the row is and then the column the frame walks — the pair that
  // makes a pane's order legible. A function with no ORDER BY has no such column, and the next
  // one along stands in rather than leaving the value sitting next to a bare name.
  const colAt = (index: number | null): Col[] =>
    index === null ? [] : [cols[visible.indexOf(index)]!].filter(Boolean);
  const frame = fn.order[0] ? findColumn(sample, visible, fn.order[0].replace(DIRECTIONS, ""), tableOf) : null;
  // A partition key the user also selected is already the bucket's header, and printing it again
  // on every member of a pane it defines says nothing — unless it is all the row has.
  const paneCols = new Set(
    fn.partition.flatMap((key) => {
      const found = findColumn(sample, visible, key, tableOf);
      return found === null ? [] : [found];
    }),
  );
  // The user's own copy of the window function, wherever it sits in their list: the column that
  // matches the walk's own value on every row. Leaving it in would hand the answer over in phase 0,
  // before the panes it comes from have even formed.
  const mirrors = (index: number): boolean =>
    sample.rows.length > 0 &&
    sample.rows.every((raw) => formatCell(raw[index] ?? null) === formatCell(raw[value] ?? null));
  // Repeating the pane's own key is only worth it when the alternative is an empty member row;
  // repeating the answer never is, so a query that selects nothing but its window function shows
  // bare rows in phase 0 and lets the value be the thing that arrives.
  const spare = visible.filter((i) => i !== frame && !keys.includes(i) && !mirrors(i));
  const rest = spare.filter((i) => !paneCols.has(i));
  const memberCols = [
    ...colAt(rest[0] ?? spare[0] ?? null),
    ...colAt(frame ?? rest[1] ?? spare[1] ?? null),
    // Phase 1 is the value arriving: one more column per row, in place, with nothing collapsing.
    ...(phase >= 1 ? [cols[cols.length - 1]!] : []),
  ].slice(0, MEMBER_COLS);

  const buckets: BucketView[] = [];
  const byKey = new Map<string, Row[]>();
  sample.rows.forEach((raw, i) => {
    const hash = hashCells(raw, keys);
    let members = byKey.get(hash);
    if (!members) {
      members = [];
      byKey.set(hash, members);
      buckets.push({
        key: `w:${hash}`,
        // With no PARTITION BY the function sees one pane holding everything, and saying so is the
        // point: the panes are not a property of the rows, they are what the clause cut.
        title: keys.length > 0 ? keys.map((k) => formatCell(raw[k] ?? null)).join(" · ") : "every row",
        members,
        count: 0,
        summary: null,
      });
    }
    members.push(rows[i]!);
  });

  return {
    kind: "buckets",
    buckets: buckets.map((bucket) => ({ ...bucket, count: bucket.members.length })),
    memberCols,
    squash: false,
    count,
  };
}
