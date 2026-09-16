// WHERE and HAVING: the same two beats — every input row judged pass or fail, then only the
// survivors — so they share one builder and differ by which clause they read and what they call
// the card.

import { PASS_COLUMN } from "../../steps";
import {
  colsOf,
  hashCells,
  mentionedColumns,
  positional,
  rowsOf,
  truthy,
  visibleIndices,
  withHl,
} from "../columns";
import type { SceneContext } from "../context";
import { okResult } from "../results";
import { EMPTY, type Row, type Scene } from "../types";
import { plain, tables } from "../view";

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
    const rows = rowsOf(source, cols, indices, "m:").map((row, i): Row => {
      const raw = source.rows[i]!;
      const pass = passAt >= 0 ? truthy(raw[passAt]) : kept.has(hashCells(raw, indices));
      return { ...row, verdict: pass ? "pass" : "fail", testIndex: i };
    });
    return tables([{ key: "main", title, cols, rows }], input);
  }
  // An empty result is the honest answer to plenty of queries, and it is exactly the answer a
  // reader is most likely to mistake for a broken step, so the card says what emptied it and how
  // many rows that took.
  const noun = station.id === "having" ? "group" : "row";
  const empty =
    input === null
      ? `No ${noun} passed this test.`
      : `All ${input} ${input === 1 ? noun : `${noun}s`} failed this test, so nothing goes on to the next step.`;
  return tables([{ ...plain("main", title, sample, own), empty }], own);
}
