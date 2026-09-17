// WHERE and HAVING: the same two beats — every input row judged pass or fail, then only the
// survivors — so they share one builder and differ by which clause they read and what they call
// the card.

import type { StatementResult } from "@perch/protocol";
import { memberColumn, memberNullColumn, PASS_COLUMN, type Station } from "../../steps";
import {
  colsOf,
  hashCells,
  mentionedColumns,
  positional,
  rowsOf,
  truthy,
  visibleIndices,
  widthFor,
  withHl,
} from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type Col, type Row, type Scene } from "../types";
import { plain, tables } from "../view";

/**
 * Which value of an `IN (…)` list each row matched, as one more column per list.
 *
 * Every cell here was decided by the database: the verdict probe carries one boolean per value and
 * one more saying whether the compared expression was null. This only reads them back. Comparing
 * the row's own value against the literals in JavaScript would be quicker and would be wrong under
 * any collation, numeric coercion or `CHAR` padding the query relies on.
 *
 * "matched nothing" and "had nothing to match with" are kept apart because they are different
 * facts about the row, and under `NOT IN` they have different consequences: a row whose left side
 * is null fails a `NOT IN` it looks like it should pass, and that surprise is the lesson.
 */
function membershipCols(
  station: Station,
  source: StatementResult,
  text: string,
): { readonly cols: readonly Col[]; readonly cells: readonly (readonly (string | null)[])[] } {
  const cols: Col[] = [];
  const cells: (string | null)[][] = [];
  for (const { list, index } of station.inLists) {
    const at = list.values.map((_, vi) =>
      source.columns.findIndex((column) => column.name === memberColumn(index, vi)),
    );
    const nullAt = source.columns.findIndex((column) => column.name === memberNullColumn(index));
    // A probe that came back without these columns is one the walk did not widen — an older result
    // still on screen, or a dialect that refused the statement. No column beats a column of nulls.
    if (at.some((i) => i < 0) || nullAt < 0) continue;
    const label = `${text.slice(list.left.from, list.left.to)} matched`;
    const values = source.rows.map((row) => {
      const won = at.findIndex((i) => truthy(row[i]));
      if (won >= 0) return text.slice(list.values[won]!.from, list.values[won]!.to);
      return truthy(row[nullAt]) ? "null — matches nothing" : "no match";
    });
    cols.push({ id: `in${index}`, label, width: widthFor(label, values), num: false, hl: true });
    cells.push(values);
  }
  return { cols, cells };
}

export function filterScene(ctx: SceneContext): Scene {
  const { parsed, phase, station, result, input, own, prevSample, mainTitle } = ctx;
  const sample = okResult(result, "sample");
  if (!sample) return EMPTY;
  const clause = station.id === "where" ? parsed.where : parsed.having;
  const body = clause ? parsed.text.slice(clause.body.from, clause.body.to) : "";
  const title = station.id === "having" ? "groups" : mainTitle;
  if (phase === 0) {
    const verdict = okResult(result, "verdict");
    const source = verdict ?? prevSample;
    if (!source) return EMPTY;
    const passAt = source.columns.findIndex((column) => column.name === PASS_COLUMN);
    const indices = visibleIndices(source);
    const cols = withHl(
      colsOf(source, indices, positional),
      new Set([...mentionedColumns(source, indices, body)].map(positional)),
    );
    const kept = new Set(sample.rows.map((row) => hashCells(row, visibleIndices(sample))));
    // Only the verdict probe carries the membership columns; when the card is falling back to the
    // previous station's sample there is nothing to read and the list stays one opaque test.
    const member = verdict ? membershipCols(station, source, parsed.text) : { cols: [], cells: [] };
    const rows = rowsOf(source, cols, indices, "m:").map((row, i): Row => {
      const raw = source.rows[i]!;
      const pass = passAt >= 0 ? truthy(raw[passAt]) : kept.has(hashCells(raw, indices));
      const extra = Object.fromEntries(
        member.cols.map((col, c) => [col.id, member.cells[c]![i] ?? null]),
      );
      return { ...row, cells: { ...row.cells, ...extra }, verdict: pass ? "pass" : "fail", testIndex: i };
    });
    return tables([{ key: "main", title, cols: [...cols, ...member.cols], rows }], input);
  }
  // An empty result is the honest answer to plenty of queries, and it is exactly the answer a
  // reader is most likely to mistake for a broken step, so the card says what emptied it and how
  // many rows that took.
  const noun = station.id === "having" ? "group" : "row";
  // A `NOT IN` list holding a null is never true of any row, whatever is in the table. It is read
  // off the query's own text rather than off a result, so it can be said even here, and it is the
  // one explanation a reader will not arrive at by staring at the rows.
  const nullTrap = station.inLists.some(({ list }) => list.negated && list.hasNull);
  const empty =
    input === null
      ? `No ${noun} passed this test.`
      : `All ${input} ${input === 1 ? noun : `${noun}s`} failed this test, so nothing goes on to the next step.`;
  const why = nullTrap
    ? ` A NOT IN list with a null in it is never true: every row's comparison to that null is unknown, so no ${noun} can pass however the rest of the list compares.`
    : "";
  return tables([{ ...plain("main", title, sample, own), empty: `${empty}${why}` }], own);
}
