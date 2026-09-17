// The sentences under an empty result. Each one has the same shape — what failed, and what the
// nearest row would have needed — and each one is written from numbers the walk already had. They
// take plain arguments rather than the card, so `terminus.ts` can build the card by calling them
// and neither file has to import the other's types.

import type { SubqueryPredicateKind } from "../clauses";
import { code, list } from "./prose";

/** The card's own title, in the accessible name and above the rows. */
export const NEAREST_TITLE = "nearest to passing";

/**
 * The nearest-miss sentence for `not exists`: the one predicate with a real gradient.
 *
 * `short by exactly one` rather than `short by 1` in the case where it is one, because that is the
 * whole point of the card and a digit does not land the way the word does. The closing clause says
 * what a single extra row would have done, which is the sentence a reader can act on.
 */
export function nearMissSentence(args: {
  /** The outer query's FROM, as written: `student s`. */
  readonly outerSource: string;
  /** A noun for one outer row: `student`. */
  readonly rowNoun: string;
  readonly kind: SubqueryPredicateKind;
  /** The rows the subquery walks, when a grid named them: `RequiredCourses rc`. */
  readonly driveTitle: string | null;
  readonly driveNoun: string;
  /** The table the inner predicate reads: `takes`. */
  readonly innerSource: string | null;
  /** The nearest row, as its own columns spell it. */
  readonly name: string;
  readonly count: number;
  /** The values it was missing, when the grid's cells named them. */
  readonly missing: readonly string[];
}): string {
  const { outerSource, rowNoun, kind, driveTitle, driveNoun, innerSource, name, count } = args;
  const one = count === 1;
  const walked =
    driveTitle === null || innerSource === null
      ? `every ${rowNoun} comes back with at least one row from it`
      : `every ${rowNoun} has at least one row of ${code(driveTitle)} with no matching row in ${code(innerSource)}`;
  const named = args.missing.length > 0 ? `, ${list(args.missing.map(code))}` : "";
  const short = one
    ? `short by exactly one ${driveNoun}${named}`
    : `short by ${count} ${driveNoun}s${named}`;
  const fix =
    innerSource === null
      ? one
        ? "one row fewer and the query would return them"
        : `${count} rows fewer and the query would return them`
      : one
        ? `a single ${code(innerSource)} row for that pair and the query would return them`
        : `${count} more ${code(innerSource)} rows and the query would return them`;
  return `No row of ${code(outerSource)} survives ${code(kind)}: ${walked}. The nearest is ${code(name)}, ${short}; ${fix}.`;
}

/**
 * The sentence for a kind with NO gradient, which is `exists` and `not in`.
 *
 * Every row that fails an `exists` fails it with a count of zero, so there is no nearest and saying
 * there is would be the one thing this card must never do. What is left that is true is what the
 * subquery would have had to find, so that is what the sentence says — and it says explicitly that
 * the rows are not ranked, because three rows in a list look ranked whatever the header says.
 */
export function noGradientSentence(args: {
  readonly outerSource: string;
  readonly kind: SubqueryPredicateKind;
  readonly predicate: string;
  readonly innerSource: string;
  /** The binding the subquery ran with, for the first failing row: `s.ID = '12345'`. */
  readonly binding: string;
}): string {
  const { outerSource, kind, predicate, innerSource, binding } = args;
  const wanted =
    kind === "not in"
      ? `Each of these rows has its value among the ones ${code(innerSource)} returned, and ${code("not in")} passes a row only when it has none of them.`
      : `What it would have taken is a single row of ${code(innerSource)} — for the first of these, one with ${code(binding)}.`;
  return `No row of ${code(outerSource)} survives ${code(predicate)}, and every one of them failed it the same way: the subquery came back empty, so there is no nearest row and these three are not ranked. ${wanted}`;
}

/** The sentence for `in` and for a scalar comparison, where near means a distance between numbers. */
export function closestSentence(args: {
  readonly outerSource: string;
  readonly predicate: string;
  readonly name: string;
  readonly gap: string;
}): string {
  return `No row of ${code(args.outerSource)} survives ${code(args.predicate)}. Nearness here is a distance between numbers, so the rows are ordered by how far the compared value was from the one the subquery came back with: ${code(args.name)} is the closest, ${args.gap}.`;
}

/**
 * The fallback, for a WHERE with no bound chapter behind it.
 *
 * `measured` is what makes the second half true: the row test brings back one boolean per depth-zero
 * conjunct, so a row that failed one of three really did come closer than a row that failed all
 * three. A single-conjunct WHERE has no such measure and the sentence stops after the first line
 * rather than claiming an order nothing produced.
 */
export function genericTerminusSentence(body: string, measured: boolean): string {
  const failed = `Every row failed ${code(body)}.`;
  return measured
    ? `${failed} The rows above are the ones that came closest, ordered by how far they were from passing.`
    : `${failed} It is a single condition, so there is no sense in which one row came closer than another; these are simply the first of the rows it threw away.`;
}
