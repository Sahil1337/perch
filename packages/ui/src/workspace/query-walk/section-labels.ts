// What a section is CALLED on the chapter strip, when it has no name of its own.
//
// Both labels are cut from the user's own spelling, because the alternative is a name the walk
// invented for something the reader can see in front of them.

import type { SelectSubquery, SubqueryPredicate } from "./clauses";
import { clip } from "./narration/prose";

/**
 * What a select-list subquery is CALLED on the chapter strip.
 *
 * The alias, when the reader wrote one: it is already their name for this number, and it is what
 * they will look for when they see it in the result. With none, naming it after the table it reads
 * would repeat the bug `predicateLabel` describes — two `count(*)`s over one table would come out
 * with the same name and be told apart by a numeral — so the fallback is the subquery as written,
 * which is the reader's own spelling and cannot be mistaken for a table's name.
 */
export function projectionLabel(subquery: SelectSubquery, sql: string): string {
  return subquery.alias ?? clip(sql.slice(subquery.range.from, subquery.range.to), LABEL_CHARS);
}

/**
 * What a subquery predicate is CALLED on the chapter strip.
 *
 * `exists`, `in` and their negations are named by the table they read, which is the thing the
 * reader is looking for: `not exists takes`. A scalar cannot be, and that was wave 8's bug — two
 * scalars over one CTE both came out as the CTE's own name, so `claimLabel` numbered them and the
 * strip read as if the CTE had been sectioned three times over. What tells a scalar apart from its
 * neighbours is the COMPARISON it sits in, so that is what names it: `i.ID = (…)`, `advises = (…)`.
 * Both halves are the user's own spelling and neither can be mistaken for the table's name.
 *
 * `sql` is the text the predicate's ranges index — the statement the predicate was found in, never
 * the subquery's own text.
 */
export function predicateLabel(predicate: SubqueryPredicate, sql: string): string {
  const source = predicate.parsed.kind === "select" ? predicate.parsed.first.name : "subquery";
  if (predicate.kind !== "scalar") return `${predicate.kind} ${source}`;
  const { left, operator } = predicate;
  // Written the other way round — `(select …) > 5` — the compared expression sits on the RIGHT of
  // the operator, and a label that swapped the sides would be quoting something nobody typed.
  if (left === null || operator === null) return source;
  const text = clip(sql.slice(left.from, left.to), LABEL_CHARS);
  return left.from > predicate.body.to ? `(…) ${operator} ${text}` : `${text} ${operator} (…)`;
}

/** Long enough for a comparison anyone writes, short enough that the strip truncates a run-on
 *  expression rather than a name that was nearly readable. */
const LABEL_CHARS = 28;
