// The right half of a per-row ledger, built per predicate kind.
//
// EXISTS, IN and a scalar comparison share a left half — the outer rows, their verdicts, the cursor
// — because that half is the same question every time: which rows got through. They do not share a
// right half, because what the subquery ANSWERED is a different kind of thing in each case, and one
// table for all three teaches the wrong lesson twice.
//
// EXISTS asks about PRESENCE, so its answer is rows and it stays an ordinary card; only the title
// changes, to say what the rows mean rather than to repeat the binding the scrubber already shows.
// IN asks about MEMBERSHIP, so its answer is a list of values with the needle lit in the hay — a
// table there invites the eye to read down a column when the question is whether one value is in
// the set at all. A scalar asks about ONE COMPARISON, so its answer is that comparison: the outer
// row's value, the operator as written, the value that came back.
//
// Nothing here probes. Every value comes from the outer probe that runs once per section and the
// per-row probe the ledger already sends for whichever row is bound.

import type { Cell, StatementResult } from "@perch/protocol";
import { formatCell } from "../../results-grid";
import type { BoundPlan, BoundRow } from "../bound";
import { sqlLiteral } from "../bound";
import type { AnswerView, ValueChip } from "./types";

/**
 * The card beside the outer rows, or null when the kind's answer is simply rows.
 *
 * Null for EXISTS and NOT EXISTS, and for anything the plan could not bring a compared value back
 * for: without the left value there is no needle to light and no left-hand side to the equation, so
 * the rows the subquery returned are the honest thing to show and the caller falls back to them.
 */
export function answerView(args: {
  readonly plan: BoundPlan;
  readonly row: BoundRow | null;
  readonly inner: StatementResult | null;
  readonly error: string | null;
}): AnswerView | null {
  const { plan, row, inner, error } = args;
  const kind = plan.predicate.kind;
  if (kind === "exists" || kind === "not exists") return null;
  if (plan.left === null || row === null) return null;
  const needle = row.leftLiteral ?? sqlLiteral(row.left, plan.dialect);
  const verdict = row.pass ? "pass" : "fail";

  if (kind === "in" || kind === "not in") {
    return {
      kind: "values",
      key: "answer",
      title: kind === "in" ? "the values it may be one of" : "the values it must not be one of",
      needleLabel: plan.left,
      needle,
      values: inner === null ? [] : chips(plan, inner, needle, kind === "not in"),
      total: inner?.rowCount ?? null,
      truncated: inner?.truncated ?? false,
      verdict,
      // A card with no chips is two different things, and saying the wrong one is worse than
      // saying nothing: the probe is still out, or it came back with nothing at all.
      empty:
        inner === null
          ? "Running the subquery for this row…"
          : kind === "in"
            ? "The subquery returned no values at all, so there is nothing for this row to be one of and it cannot pass."
            : "The subquery returned no values at all, so there is nothing for this row to be one of, so it is trivially none of them and the row passes.",
      error,
    };
  }

  // A scalar. The subquery is promised exactly one row; both ways it can break that promise are
  // facts the view has to state rather than smooth over — see `many` and `missing`.
  const values = inner?.rows ?? [];
  const first = values[0];
  const value = first === undefined ? null : (first[0] ?? null);
  return {
    kind: "equation",
    key: "answer",
    title: "the value it came back with",
    leftLabel: plan.left,
    left: needle,
    operator: plan.predicate.operator ?? "=",
    right: inner === null ? "…" : sqlLiteral(value, plan.dialect, inner.columns[0]),
    verdict,
    missing: inner !== null && values.length === 0,
    many: values.length > 1 ? (inner?.rowCount ?? values.length) : null,
    error,
  };
}

/**
 * The returned values, with the needle lit and any null marked as the poison.
 *
 * The match is decided on the LITERAL rather than on the raw cell, for the same reason the grid
 * matches its rows that way: both sides are spelled by `sqlLiteral`, so what the eye compares and
 * what the SQL would compare are the same string. A null never counts as a match, because `= null`
 * is unknown and not true — which is exactly the trap the poison mark exists to name.
 */
function chips(
  plan: BoundPlan,
  inner: StatementResult,
  needle: string,
  negated: boolean,
): ValueChip[] {
  const column = inner.columns[0];
  const seen = new Map<string, number>();
  return inner.rows.map((row): ValueChip => {
    const value: Cell = row[0] ?? null;
    const literal = sqlLiteral(value, plan.dialect, column);
    const dup = seen.get(literal) ?? 0;
    seen.set(literal, dup + 1);
    return {
      key: `${literal}${dup > 0 ? `#${dup}` : ""}`,
      text: formatCell(value),
      match: value !== null && literal === needle,
      poison: negated && value === null,
    };
  });
}
