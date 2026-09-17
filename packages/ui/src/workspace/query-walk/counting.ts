// Asking a subquery HOW MANY rows it matched, when that question has an honest answer.
//
// The per-row ledger shows a count beside each outer row, and the count has to come from the
// database rather than from anything the walk worked out. That means rewriting the subquery into
// one that counts — and refusing, rather than guessing, whenever the rewrite would change what is
// being counted.

import type {
  ParsedSelect,
  Range,
  SubqueryPredicate,
  SubqueryPredicateKind,
  Unsupported,
} from "./clause-types";
import { spliceRanges, WALK_PREFIX } from "./splice";

/** Aggregates that already collapse a subquery to one row, so counting its "matches" is a lie. */
const AGGREGATES = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "every",
  "bool_and",
  "bool_or",
  "array_agg",
  "string_agg",
  "json_agg",
  "jsonb_agg",
  "json_object_agg",
  "jsonb_object_agg",
  "bit_and",
  "bit_or",
  "stddev",
  "stddev_pop",
  "stddev_samp",
  "variance",
  "var_pop",
  "var_samp",
  "group_concat",
]);

/**
 * The subquery rewritten to yield one row holding its match count, for a per-row probe.
 *
 * Replacing the inner query's own select list with `count(*)` in place leaves any correlation to
 * the outer row exactly where it was, and because it is done by splicing the user's ranges the
 * FROM and WHERE are still their text. This is the portable shape — it asks nothing of the dialect
 * beyond `count(*)` — so it is the first choice everywhere.
 *
 * Returns null rather than something subtly wrong when the count would not mean "matching rows".
 * `countingWrap` covers those shapes instead; only when it is refused too does the caller fall
 * back on a plain boolean.
 */
export function countingRewrite(predicate: SubqueryPredicate): string | null {
  const parsed = predicate.parsed;
  if (parsed.kind !== "select") return null;
  // GROUP BY or HAVING makes count(*) count per group, so the probe would return many rows where
  // the caller expects exactly one.
  if (parsed.groupBy !== null || parsed.having !== null) return null;
  // count(*) counts rows, not distinct ones, so it would overstate a DISTINCT subquery.
  if (parsed.distinct !== null) return null;
  // LIMIT and OFFSET cut the rows the count is meant to measure, and they apply before it here.
  if (parsed.limit !== null || parsed.offset !== null) return null;
  // An already-aggregating subquery returns one row whatever matched, so counting it yields 1 and
  // says nothing. The check reads the select-list expressions this file already extracted, not the
  // raw SQL.
  if (parsed.selectItems.some(isAggregateCall)) return null;

  const edits: { range: Range; with: string }[] = [{ range: parsed.selectList, with: "count(*)" }];
  // ORDER BY is meaningless on a single count, and once the list is an aggregate the sort key is
  // rejected outright: `select count(*) from takes order by takes.course_id` is an error, because
  // the column appears in neither an aggregate nor a GROUP BY.
  if (parsed.orderBy) edits.push({ range: parsed.orderBy.range, with: "" });
  return spliceRanges(parsed.text, parsed.statement, edits);
}

/** The derived table `countingWrap` counts from. Prefixed so it can never shadow a user alias. */
const WRAP_ALIAS = `${WALK_PREFIX}wrap`;

/**
 * The subquery wrapped so its rows are counted from outside, for the shapes `countingRewrite`
 * cannot splice (DISTINCT, GROUP BY / HAVING, LIMIT / OFFSET, an already-aggregating list).
 *
 * Postgres resolves an outer reference through the derived table, so a correlated subquery still
 * counts per outer row — verified against PostgreSQL 18. MySQL needs LATERAL for that and will
 * reject it, so a caller must treat a failure here as "fall back to a boolean" rather than as a
 * bug in the user's query.
 *
 * The body goes in untouched, which is the whole point: DISTINCT, GROUP BY and LIMIT keep their
 * meaning and the outer `count(*)` counts the rows they actually produced.
 */
export function countingWrap(predicate: SubqueryPredicate): string | null {
  const parsed = predicate.parsed;
  if (parsed.kind !== "select") return null;
  // `statement` rather than `body`: it ends at the last token, so a trailing `-- comment` inside
  // the parentheses cannot swallow the `) as …` that follows it.
  const inner = parsed.text.slice(parsed.statement.from, parsed.statement.to).trim();
  return `select count(*)\nfrom (\n${inner}\n) as ${WRAP_ALIAS}`;
}

function isAggregateCall(item: string): boolean {
  const open = item.indexOf("(");
  if (open < 0) return false;
  return AGGREGATES.has(item.slice(0, open).trim().toLowerCase());
}

/**
 * Whether the subquery already collapses to exactly one row, whatever matched.
 *
 * This is the shape `countingWrap` is a trap for: it wraps the body untouched, so counting an
 * aggregate that returns one row returns 1 for every outer row — a number that looks like a match
 * count, is not one, and cannot be told apart from a real single match once it is on screen. A
 * caller must ask this before trusting a wrapped count and show no count at all when it is true.
 * GROUP BY is deliberately not included: it returns one row PER GROUP, so counting those rows
 * really does count something the reader can see.
 */
export function collapsesToOneRow(predicate: SubqueryPredicate): boolean {
  const parsed = predicate.parsed;
  if (parsed.kind !== "select") return false;
  return parsed.groupBy === null && parsed.selectItems.some(isAggregateCall);
}

/**
 * Whether a subquery's select list can be widened to `*` for a probe.
 *
 * EXISTS throws the select list away — `select 1` and `select *` are the same question to it — so
 * showing the columns instead of a column of `1`s costs nothing and is the difference between "one
 * row came back" and "CS-319 came back". For IN and for a scalar comparison the list is the VALUE
 * being compared, so it stays exactly as written. GROUP BY, HAVING, DISTINCT and a WINDOW clause
 * all make `*` either illegal or a different query, so they rule it out too.
 *
 * A parse that is not a SELECT is refused rather than widened: the caller would otherwise take a
 * select-list range off something that has no select list.
 */
export function canWidenSelectList(
  parsed: ParsedSelect | Unsupported,
  kind: SubqueryPredicateKind,
): boolean {
  if (kind !== "exists" && kind !== "not exists") return false;
  if (parsed.kind !== "select") return false;
  return (
    parsed.groupBy === null &&
    parsed.having === null &&
    parsed.distinct === null &&
    parsed.window === null
  );
}
