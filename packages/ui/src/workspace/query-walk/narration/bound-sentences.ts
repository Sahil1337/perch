// A section that runs once per outer row has no station walk, so it has no station sentences. What
// it has instead is one sentence about the section — what correlation means for it — and one about
// whichever outer row is currently bound, which changes as playback moves through them.
//
// IN and the scalar comparison both get a card of their own rather than the rows EXISTS shows, and
// both get a sentence of their own for the same reason: what the subquery answered is a different
// KIND of thing. IN answers whether a value is in a set. A scalar answers with one value, and has
// two failure modes that no other predicate has — more than one row is an error, and no row at all
// is a null that makes the comparison unknown rather than false.

import type { BoundPlan, BoundRow } from "../bound";
import type { SubqueryPredicateKind } from "../clauses";
import type { AnswerView } from "../scenes";
import { code, list } from "./prose";

/** What the predicate needs of the subquery's rows, as a noun phrase: "`exists` needs …". */
export function passRule(kind: SubqueryPredicateKind): string {
  switch (kind) {
    case "not exists":
      return "no rows at all";
    case "exists":
      return "at least one row";
    case "in":
      return "a row holding the value on the left";
    case "not in":
      return "no row holding the value on the left";
    case "scalar":
      return "a single value the comparison holds against";
  }
}

/**
 * `s.ID = '12345'`: the substitutions this row's probe actually made, one per correlated column.
 *
 * The pairs rather than a sentence, because the two callers want different things from them — a
 * card title joins them, and a cell's sentence puts the grid column's own substitution alongside
 * them first. `bindingLine` is the joined form, for everywhere that just wants the phrase.
 */
export function bindingPairs(plan: BoundPlan, row: BoundRow): string[] {
  return plan.columns.map(
    (column) => `${column.ref} = ${row.literals.get(column.ref) ?? "null"}`,
  );
}

export function bindingText(plan: BoundPlan, row: BoundRow): string {
  return bindingPairs(plan, row).join(", ");
}

/**
 * The title over the card of rows the subquery came back with.
 *
 * It says what the rows MEAN rather than repeating the binding, which the scrubber under the stage
 * is already showing: under `exists` they are what the predicate found, and under `not exists` they
 * are the evidence against the row — so an EMPTY card there is the good one, and a title that only
 * said `s.ID = '12345'` left the reader to work that out for themselves. IN and a scalar have cards
 * of their own with their own titles and never reach this.
 */
export function boundInnerTitle(plan: BoundPlan, row: BoundRow): string {
  const bound = bindingText(plan, row);
  switch (plan.predicate.kind) {
    case "exists":
      return `found for ${bound}`;
    case "not exists":
      return `what disqualifies ${bound}`;
    default:
      return bound;
  }
}

/** What this section IS: why it has no single result, and what its outer query wants from it. */
export function boundSentence(plan: BoundPlan): string {
  const columns = list(plan.columns.map((column) => code(column.ref)));
  const named = columns === "" ? "a value from the row it sits inside" : columns;
  return `Every row of ${plan.outer.label} hands this subquery its own ${named}, so it does not run once — it runs again for each of them, and the rows it comes back with change every time. ${code(plan.predicate.kind)} then passes the outer row only when the answer is ${passRule(plan.predicate.kind)}.`;
}

/** What happened for the row currently bound: the values put in, the rows that came back, the verdict. */
export function boundRowSentence(plan: BoundPlan, row: BoundRow): string {
  const bound = list(
    plan.columns.map((column) => code(`${column.ref} = ${row.literals.get(column.ref) ?? "null"}`)),
  );
  const answer =
    row.matches === null
      ? "the subquery runs with those values in place of the outer row's"
      : row.matches === 0
        ? "the subquery comes back empty"
        : `the subquery comes back with ${row.matches} ${row.matches === 1 ? "row" : "rows"}`;
  const verdict = row.pass ? "passes" : "fails";
  return `With ${bound}, ${answer}, so this row ${verdict}: ${code(plan.predicate.kind)} needs ${passRule(plan.predicate.kind)}.`;
}

/* ── IN and the scalar comparison ──────────────────────────────────────────────────────────────
 *
 * Both of these get a card of their own rather than the rows EXISTS shows, and both get a sentence
 * of their own for the same reason: what the subquery answered is a different KIND of thing. IN
 * answers whether a value is in a set. A scalar answers with one value, and has two failure modes
 * that no other predicate has — more than one row is an error, and no row at all is a null that
 * makes the comparison unknown rather than false.
 */

/** What `x in (…)` did for this row: the value on the left, and whether the set holds it. */
export function membershipSentence(plan: BoundPlan, row: BoundRow, answer: AnswerView): string {
  if (answer.kind !== "values") return boundRowSentence(plan, row);
  const negated = plan.predicate.kind === "not in";
  const found = answer.values.some((value) => value.match);
  const poisoned = answer.values.some((value) => value.poison);
  const bound = bindingText(plan, row);
  const rule = `${code(plan.predicateText)} passes a row when its ${code(answer.needleLabel)} is ${
    negated ? "none of" : "one of"
  } the values the subquery returns.`;
  // The null case is not "it is not in the list": it is that nothing can be PROVED about the list
  // at all, and saying "not in the list, so the row fails" would teach the wrong reason.
  if (negated && poisoned) {
    return `${rule} For ${code(bound)} the value is ${code(answer.needle)}, but the subquery returned a null among its values, so the row fails whatever that value is.`;
  }
  return `${rule} For ${code(bound)} the value is ${code(answer.needle)}, and it is ${
    found ? "in" : "not in"
  } the list, so the row ${row.pass ? "passes" : "fails"}.`;
}

/** What the scalar comparison came out as for this row, in the three cells the card shows. */
export function scalarSentence(plan: BoundPlan, row: BoundRow, answer: AnswerView): string {
  if (answer.kind !== "equation") return boundRowSentence(plan, row);
  const bound = bindingText(plan, row);
  const rule = `${code(plan.predicateText)} compares each row's ${code(answer.leftLabel)} against the one value the subquery returns.`;
  if (answer.many !== null) {
    return `${rule} For ${code(bound)} it returned ${answer.many} rows, which is not a value at all — the database raises an error rather than choosing one of them.`;
  }
  if (answer.missing) {
    return `${rule} For ${code(bound)} it returned no row, so the value is null, ${code(`${answer.left} ${answer.operator} null`)} is unknown rather than false, and the row is dropped exactly as a false one would be.`;
  }
  return `${rule} For ${code(bound)} the value is ${code(answer.right)}, and ${code(`${answer.left} ${answer.operator} ${answer.right}`)} is ${row.pass}, so the row ${row.pass ? "passes" : "fails"}.`;
}

/**
 * The NOT IN null trap, which is the reason `not exists` is usually what people mean.
 *
 * One null anywhere in the set is fatal to EVERY row, not just to rows that are null themselves,
 * and that is the part nobody predicts: `not in` is `<> all`, a comparison to null is unknown, and
 * a predicate that is unknown never passes a WHERE. Null when there is no null to warn about.
 */
export function notInNullSentence(plan: BoundPlan, answer: AnswerView): string | null {
  if (plan.predicate.kind !== "not in" || answer.kind !== "values") return null;
  if (!answer.values.some((value) => value.poison)) return null;
  // "this row" rather than "every row": the set a CORRELATED subquery returns is a different set
  // per outer row, so a null in one row's set says nothing about the next row's. The rule it
  // demonstrates is the same one, and it is the rule that costs people afternoons.
  return `The subquery returns a null among its values, and ${code("not in")} compares against every value with ${code("=")}; a comparison to null is unknown, so nothing can be proved absent and this row fails whatever its value is. One null anywhere in the set is enough, and over a set that does not change per row that is every row at once — which is the reason ${code("not exists")} is usually what people mean.`;
}

/** The promise a scalar subquery makes, and both ways of breaking it. Null for every other kind. */
export function scalarShapeSentence(plan: BoundPlan, answer: AnswerView): string | null {
  if (plan.predicate.kind !== "scalar" || answer.kind !== "equation") return null;
  return `A subquery in this position must return exactly one row: more than one is an error the database raises, and none at all is a null, which makes the comparison unknown and drops the row without ever being false.`;
}

/**
 * The null sentence, which is a lesson rather than an edge case.
 *
 * A correlated value that is null makes every comparison against it unknown, not false, so the
 * subquery matches nothing however full the table is. The walk writes `= null` rather than quietly
 * turning it into `is null`, because `= null` is what the database evaluates and repairing it would
 * hide the only reason this row's answer is empty.
 */
export function boundNullSentence(refs: readonly string[]): string | null {
  if (refs.length === 0) return null;
  const named = list(refs.map(code));
  const plural = refs.length > 1;
  return `${named} ${plural ? "are" : "is"} null on this row, so every comparison against ${plural ? "them" : "it"} is unknown rather than false and no row can match, however full the table is. ${code("= null")} is never true — not even against another null — which is why this answer is empty and why SQL has ${code("is null")} for the test people mean.`;
}

/** Why there is no match count, when there is none. Null when the count came back. */
export function boundCountSentence(plan: BoundPlan): string | null {
  if (plan.counting !== null) return null;
  return `There is no match count beside these rows. ${
    plan.wrapped
      ? "Counting a subquery of this shape means wrapping it in a derived table, and this database would not resolve the outer row through one — that is a limit of the dialect, not a fault in the query."
      : "This subquery already collapses to a single row whatever matched, so counting it would say 1 for every outer row and mean nothing."
  } The verdict beside each row is ${code(plan.predicate.kind)} itself, asked of the database, so it still holds.`;
}
