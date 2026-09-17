// The three stations a recursive CTE gets once `program.ts` has proved its shape.

import { type Range } from "../clauses";
// Type-only, and deliberately so: `program.ts` reaches `grid.ts`, which reaches back here, and an
// import that survived to runtime would close that ring. What the walk needs from a `Recursion` is
// its shape, which costs nothing at run time.
import type { Recursion } from "../program";
import { station, wrap, type Station } from "../station-types";

/**
 * The three stations a recursive CTE gets once `program.ts` has proved its shape: START, REPEAT,
 * SETTLE.
 *
 * All three are `id: "result"` — a rows card and a count, the same one `buildResultStation` gets —
 * because what they teach is the DIFFERENCE between three tables, not anything happening inside one
 * of them. A scene of their own would have to animate a loop the walk deliberately does not run.
 *
 * REPEAT is the only one that rewrites anything, and what it does is the rewrite the database does
 * on its first pass: `chain c` becomes `(<the anchor>) c`. It is spliced BY RANGE, right to left,
 * off the ranges `readRecursion` recorded — a string replace of the name would also hit the `chain`
 * in a column called `chain_id`, in a quoted identifier, or in a literal, and the statement it built
 * would run and be wrong rather than fail.
 *
 * `prefix` is the whole WITH list this section runs with, the recursive CTE included, and it is
 * rendered ONCE at the head of each statement. Three things follow from that. The anchor spliced
 * into REPEAT carries no prefix of its own, because a WITH inside a derived table is not legal
 * there. The count wrapper keeps the prefix outside its subquery, for the same reason. And the CTE
 * sitting unreferenced in START's and REPEAT's prefix costs nothing: an unreferenced CTE is not
 * executed, recursive or not, so neither statement ever runs the recursion it is explaining.
 */
export function buildRecursionStations(
  recursion: Recursion,
  prefix: string,
  cteName: string,
  wholeText: string,
): Station[] {
  // Nothing is appended to any of these, so the newline rule at the top of the file applies only
  // where the wrapper puts a body on its own line — which it does, for exactly that reason.
  const { counted } = wrap(prefix);
  /** One of the three: a rows card and a count, with the sentence the program wrote for it. */
  const pane = (
    key: string,
    label: string,
    sampleLabel: string,
    body: string,
    sample: string,
    sentence: string,
    root: Range | null,
  ): Station =>
    station({
      key,
      id: "result",
      label,
      present: true,
      // The statement these run is not the section's own text, so an offset into it would index
      // nothing the narrator could point at. `root` carries the reader's line instead.
      clause: null,
      batches: [
        [
          { id: "sample", label: sampleLabel, sql: sample },
          { id: "count", label: "Count", sql: counted(body) },
        ],
      ],
      sentence,
      root,
    });

  const settleBody = `select * from ${cteName}`;
  const pass = firstPass(recursion);
  return [
    pane(
      "recursion.start",
      "START",
      "Where the recursion begins",
      recursion.anchorSql,
      `${prefix}${recursion.anchorSql}`,
      recursion.sentences.start,
      recursion.anchor,
    ),
    pane(
      "recursion.repeat",
      "REPEAT",
      "One pass of the step",
      pass,
      `${prefix}${pass}`,
      recursion.sentences.repeat,
      recursion.step,
    ),
    pane(
      "recursion.settle",
      "SETTLE",
      "The whole CTE, every pass run",
      settleBody,
      wholeText,
      recursion.sentences.settle,
      recursion.anchor === null || recursion.step === null
        ? null
        : { from: recursion.anchor.from, to: recursion.step.to },
    ),
  ];
}

/**
 * The recursive term with the anchor standing in for the CTE: what the database computes on its
 * first pass, and the only pass the walk can show without iterating.
 *
 * The alias is kept as the reader wrote it — `chain c` becomes `(…) c` — because the rest of the
 * term is full of `c.id` and a derived table under any other name would not resolve them. Where
 * they wrote no alias the CTE's own name takes its place, which is what they were already using.
 */
function firstPass(recursion: Recursion): string {
  let out = recursion.stepSql;
  for (const ref of [...recursion.selfRefs].sort((a, b) => b.range.from - a.range.from)) {
    out = `${out.slice(0, ref.range.from)}(${recursion.anchorSql}) ${ref.alias}${out.slice(ref.range.to)}`;
  }
  return out;
}
