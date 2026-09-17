// Whether a subquery depends on the row of the query around it.
//
// This is the property the whole program hangs on, and the one place it is allowed to be uncertain.
// `SubqueryPredicate.correlated` reports only QUALIFIED references, because `course_id` with no
// table in front of it cannot be resolved without a catalogue — so an empty list means "no PROVABLE
// correlation", never "uncorrelated". Promoting such a subquery to a standalone section would run
// it once and print a value that is true of no row, which is why the uncertainty is carried as
// `Binding.certain` rather than flattened here.

import type { Dialect } from "@perch/protocol";
import {
  bareName,
  countingRewrite,
  isSetOp,
  isUnsupported,
  parseStatement,
  statementShape,
  type ParsedSelect,
  type Range,
  type SelectSubquery,
  type SubqueryPredicate,
  type Unsupported,
} from "./clauses";
import {
  isSelectParens,
  nodeContaining,
  parserFor,
  type SyntaxNode,
} from "./clause-tokens";
import type { Binding, SkippedPart } from "./program-types";
import { predicateLabel } from "./section-labels";

/**
 * How a subquery predicate runs, or null when it should stay inline with no section at all.
 *
 * A correlated scalar subquery that `countingRewrite` refuses — an aggregate, a GROUP BY, a LIMIT —
 * has nothing a per-row probe could usefully ask: it returns one row whatever the outer row is, and
 * counting its "matches" would be a lie. A section for it could only ever show a query it cannot
 * run, so the predicate is left where it is, recorded as inline rather than dropped.
 */
export function predicateBinding(
  /** Where a predicate left inline is recorded, which is the one thing this writes. */
  skipped: SkippedPart[],
  dialect: Dialect,
  predicate: SubqueryPredicate,
  sql: string,
  path: string,
): Binding | null {
  if (predicate.correlated.length > 0) {
    if (predicate.kind === "scalar" && countingRewrite(predicate) === null) {
      skipped.push({
        why: "inline",
        label: predicateLabel(predicate, sql),
        reason:
          "A correlated scalar subquery that already aggregates has no per-row result to walk.",
        sql: sql.slice(predicate.range.from, predicate.range.to),
      });
      return null;
    }
    return { kind: "bound", outer: path, columns: predicate.correlated };
  }
  return {
    kind: "standalone",
    certain: bodyIsCertainlyUncorrelated(
      predicate.parsed,
      sql.slice(predicate.body.from, predicate.body.to),
      sql,
      dialect,
      predicate.kind === "scalar",
    ),
  };
}

/**
 * How a select-list subquery runs.
 *
 * The same two answers a predicate gets, with one escape hatch fewer: there is no "leave it inline"
 * here, because a number on screen that no chapter accounts for is the whole thing this is fixing.
 *
 * A correlated one is bound even though nothing can probe it yet — `boundPlan` refuses it and the
 * chapter holds with a note — because the alternative is to call it standalone and run it once,
 * which prints a value that is true of no row. `certain` carries the other half of that caution:
 * see `isCertainlyUncorrelated`, which is asked to read the select list here because a select-list
 * subquery is all value, and a bare name in the list that secretly belongs to the outer row changes
 * that value on every row.
 */
export function projectionBinding(
  subquery: SelectSubquery,
  sql: string,
  path: string,
  dialect: Dialect,
): Binding {
  if (subquery.correlated.length > 0) {
    return { kind: "bound", outer: path, columns: subquery.correlated };
  }
  return {
    kind: "standalone",
    certain: bodyIsCertainlyUncorrelated(
      subquery.parsed,
      sql.slice(subquery.body.from, subquery.body.to),
      sql,
      dialect,
      true,
    ),
  };
}

/**
 * The same question for a body that may be a SET OPERATION.
 *
 * `parseTokens` refuses a chain of SELECTs, so `parsed` arrives `unsupported` and the check below
 * would call it uncertain on principle — which is how `where ID in (select … intersect select …)`
 * came to wear "could not rule out that this depends on the outer row" while plainly depending on
 * nothing. A chain is exactly as answerable as one SELECT: it is correlated only if some BRANCH is,
 * and every branch is an ordinary `ParsedSelect`.
 *
 * The re-parse is of the body alone, so the branches' ranges index the body rather than the whole
 * statement, and the branch text has to be handed down with them. It is the same parse the section
 * builder already makes for this predicate, so the two cannot disagree about what is being walked.
 */
function bodyIsCertainlyUncorrelated(
  parsed: ParsedSelect | Unsupported,
  body: string,
  sql: string,
  dialect: Dialect,
  valueMatters: boolean,
): boolean {
  if (parsed.kind === "select") return isCertainlyUncorrelated(parsed, sql, dialect, valueMatters);
  const whole = parseStatement(body, dialect);
  if (isUnsupported(whole) || !isSetOp(whole)) return false;
  return whole.branches.every(
    (branch) =>
      branch.parsed.kind === "select" &&
      isCertainlyUncorrelated(branch.parsed, whole.text, dialect, valueMatters),
  );
}

/**
 * Whether the text alone rules out a correlation, given nothing qualified pointed outward.
 *
 * Correlation enters through a FILTER: the WHERE, HAVING, JOIN ON/USING or GROUP BY of the subquery
 * is where an unqualified name that secretly belongs to the outer row changes which rows come back.
 * A subquery with no such clause — `select ID from takes` — has nowhere for one to hide, so it is
 * certain even though `ID` is unqualified.
 *
 * The select list is scanned only when the VALUE is what the caller uses — a scalar predicate, or a
 * subquery in the select list, where an outward-bound name in the list changes the number that
 * lands on the row. For EXISTS the list is discarded outright, and for IN a list that bound outward
 * would compare the outer row to itself — a query nobody writes. That is a judgement call, and it is
 * the one place this can still say "certain" about something a catalogue would disagree with.
 *
 * A bare name found in one of those ranges is not the end of it: see `resolvesLocally`.
 */
function isCertainlyUncorrelated(
  parsed: ParsedSelect | Unsupported,
  sql: string,
  dialect: Dialect,
  /** The subquery's VALUE is what the caller uses, so its select list is one more place a
   *  correlation can hide. True for a scalar predicate and for every select-list subquery; false
   *  for EXISTS and IN, which throw the value away or compare it to the outer row on purpose. */
  valueMatters: boolean,
): boolean {
  // A subquery we could not slice tells us nothing, so it cannot be called certain.
  if (parsed.kind !== "select") return false;
  const ranges: Range[] = [];
  if (parsed.where) ranges.push(parsed.where.body);
  if (parsed.having) ranges.push(parsed.having.body);
  if (parsed.groupBy) ranges.push(parsed.groupBy.body);
  for (const join of parsed.joins) {
    if (join.range.to > join.source.range.to)
      ranges.push({ from: join.source.range.to, to: join.range.to });
  }
  if (valueMatters) ranges.push(parsed.selectList);
  const bare = bareColumnRefs(sql, dialect, ranges);
  if (bare.length === 0) return true;
  return resolvesLocally(bare, parsed, dialect);
}

/**
 * Whether every bare name in a subquery is provably a column of the subquery's own source.
 *
 * The conservatism above exists because `course_id` with no table in front of it cannot be resolved
 * without a catalogue — and against a real table there is none to read, so it stays uncertain. But
 * when the source is a CTE the walk has a catalogue, and it is one the program itself built: the
 * CTE's output columns are its select list, which is text. `advises` inside
 * `select i_id from advisor_teaches where advises = …` is therefore not a maybe — it is the CTE's
 * own column, the subquery is uncorrelated, and wave 8's warning on it was simply false.
 *
 * Three things keep the conservatism where it is earned. The subquery must have exactly ONE source,
 * because with two the name could belong to either and knowing one catalogue settles nothing. That
 * source must be a CTE, because a plain table's columns are in the database and not in the query.
 * And the CTE's own list must NAME all of its columns — a `select *` inside it, or a set operation,
 * puts the answer back in the catalogue — with every bare name found among them; one that is not is
 * exactly the reference that might point outward, and it keeps the caveat for the whole subquery.
 */
function resolvesLocally(bare: readonly string[], parsed: ParsedSelect, dialect: Dialect): boolean {
  if (parsed.joins.length > 0) return false;
  if (parsed.first.kind !== "cte" || parsed.first.body === null) return false;
  // The CTE's body is a range into the same text, because the parse was seeded with the CTEs the
  // enclosing WITH put in scope; re-parsing it is how its select list becomes a list of names.
  const body = parseStatement(
    parsed.text.slice(parsed.first.body.from, parsed.first.body.to),
    dialect,
  );
  if (isUnsupported(body) || isSetOp(body) || body.selectNames === null) return false;
  const known = new Set(body.selectNames.map((name) => name.toLowerCase()));
  return bare.every((name) => known.has(name));
}

/**
 * Whether running `sql` as written would change the database.
 *
 * The test is on the WHOLE statement, prefix included, and that is the point: a section is refused
 * the moment a data-modifying CTE is spliced into it, not only when it IS one. The walk probes
 * every station of every section, and each of those probes carries the section's own WITH — so one
 * `delete … returning *` in a WITH list is a delete per probe, not a delete once.
 *
 * Postgres allows a data-modifying statement only in the WITH attached to the top-level statement,
 * so descending into nested CTE bodies is belt-and-braces rather than the case that happens.
 */
export function carriesWrite(sql: string, dialect: Dialect): boolean {
  const shape = statementShape(sql, dialect);
  if (shape.kind === "write") return true;
  return shape.ctes.some((cte) => carriesWrite(sql.slice(cte.body.from, cte.body.to), dialect));
}


/**
 * Every column reference in `ranges` that nobody qualified, lower-cased and de-quoted.
 *
 * `CompositeIdentifier` is `s.ID` — already qualified, and wave 1's correlation check has had its
 * say about it. A nested `(select …)` is skipped: it is its own scope and its own section, and what
 * it leaves unqualified is its own problem, not this one's.
 *
 * The names rather than a bare boolean, because the caller can now sometimes RESOLVE one: a name
 * that is an output column of the CTE the subquery reads is provably local, and telling that from a
 * name that is not needs the name itself.
 */
function bareColumnRefs(text: string, dialect: Dialect, ranges: readonly Range[]): string[] {
  if (ranges.length === 0) return [];
  const tree = parserFor(dialect).parse(text);
  const out: string[] = [];
  for (const range of ranges) scanBare(nodeContaining(tree.topNode, range), text, range, out);
  return out;
}

function scanBare(node: SyntaxNode, text: string, range: Range, out: string[]): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= range.from || child.from >= range.to) continue;
    if (child.name === "CompositeIdentifier") continue;
    if (child.name === "Identifier" || child.name === "QuotedIdentifier") {
      // `upper(name)` puts the function's own name in an Identifier node; the argument list that
      // follows it with no gap is what tells the two apart.
      const next = child.nextSibling;
      if (next && next.name === "Parens" && next.from === child.to) continue;
      out.push(bareName(text.slice(child.from, child.to)).toLowerCase());
      continue;
    }
    // The grammar calls `ID`, `name`, `year` and `value` keywords, because some dialect reserves
    // them — but in a WHERE they are columns like any other, and skipping them was the difference
    // between "could not be ruled out" and a confident, wrong "uncorrelated" on half the queries
    // anyone writes against a schema that spells a key `ID`. A word that is SYNTAX in an expression
    // is skipped by name, and a word followed straight by `(` is a function call rather than a
    // column. What is left over may still be a keyword this list has never heard of, and that is the
    // direction to err in: an unknown word counted here costs a caveat, and one missed costs a
    // correlated subquery run once and reported as fact.
    if (child.name === "Keyword") {
      const word = text.slice(child.from, child.to).toLowerCase();
      const call = child.nextSibling;
      if (EXPRESSION_WORDS.has(word)) continue;
      if (call && call.name === "Parens" && call.from === child.to) continue;
      out.push(word);
      continue;
    }
    if (child.name === "Parens" && isSelectParens(child, text)) continue;
    scanBare(child, text, range, out);
  }
}

/**
 * Every word that can appear inside a WHERE, HAVING, GROUP BY, ON or select list without being a
 * column reference: the operators and literals spelled as words, the clause words a scanned range
 * can run into, the frame vocabulary of an OVER clause, and the type names a cast can mention.
 *
 * Deliberately a list of SYNTAX and not a list of keywords. The grammar's keyword set includes
 * plenty of ordinary column names — that is the whole reason this exists — so a word is dropped
 * here only when reading it as a column would be a mistake, and every word nobody thought of stays
 * a possible column. `first` and `last` are in no stop list for that reason: they are syntax only in
 * an ORDER BY, which is not a range this ever scans.
 */
const EXPRESSION_WORDS = new Set([
  "and",
  "or",
  "not",
  "is",
  "isnull",
  "notnull",
  "in",
  "between",
  "like",
  "ilike",
  "similar",
  "to",
  "escape",
  "exists",
  "any",
  "all",
  "some",
  "unique",
  "overlaps",
  "symmetric",
  "asymmetric",
  "null",
  "true",
  "false",
  "unknown",
  "default",
  "case",
  "when",
  "then",
  "else",
  "end",
  "select",
  "from",
  "where",
  "group",
  "having",
  "order",
  "by",
  "limit",
  "offset",
  "fetch",
  "with",
  "as",
  "on",
  "using",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "natural",
  "lateral",
  "union",
  "intersect",
  "except",
  "distinct",
  "asc",
  "desc",
  "nulls",
  "collate",
  "over",
  "partition",
  "window",
  "filter",
  "within",
  "rows",
  "range",
  "groups",
  "preceding",
  "following",
  "unbounded",
  "current",
  "row",
  "exclude",
  "ties",
  "others",
  "only",
  "cast",
  "interval",
  "at",
  "zone",
  "local",
  "localtime",
  "localtimestamp",
  "current_date",
  "current_time",
  "current_timestamp",
  "current_user",
  "session_user",
  "user",
  "array",
  "boolean",
  "bool",
  "int",
  "integer",
  "smallint",
  "bigint",
  "decimal",
  "numeric",
  "real",
  "double",
  "precision",
  "float",
  "char",
  "character",
  "varchar",
  "varying",
  "text",
  "bytea",
  "json",
  "jsonb",
  "uuid",
  "money",
  "date",
  "time",
  "timestamp",
  "timestamptz",
  "extract",
  "substring",
  "trim",
  "position",
  "overlay",
  "leading",
  "trailing",
  "both",
  "for",
]);
