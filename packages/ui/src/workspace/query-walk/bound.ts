// Probing a section that runs once for every row of another one.
//
// A correlated subquery has no single result, so the walk asks the database two different questions
// about it. The first is asked once: the OUTER section's own query, with the subquery spliced back
// in as a counting expression, so every outer row arrives carrying the number of rows the subquery
// returned for it and the verdict the predicate reached. The second is asked per row, on demand:
// the subquery itself with each correlated reference replaced by that row's value.
//
// THE DEPARTURE. Everywhere else this module only ever splices the user's own ranges back together,
// and `boundRowSql` below is the one place that writes something the user did not type: a literal,
// over the range where a correlated reference was written. That is deliberate and it is the whole
// point of the feature — `takes.ID = s.ID` becoming `takes.ID = '12345'` is what the database does
// per row, and seeing it is the lesson. It stays contained here: `outerProbeSql` splices only
// ranges, and nothing else in the walk builds a literal.

import type { Cell, Dialect, ResultColumn, StatementResult } from "@perch/protocol";
import {
  collapsesToOneRow,
  countingRewrite,
  countingWrap,
  isSetOp,
  refRanges,
  spliceRanges,
  WALK_PREFIX,
  type ParsedSelect,
  type Range,
  type SubqueryPredicate,
  type SubqueryPredicateKind,
} from "./clauses";
import { sectionById, type Program, type Section } from "./program";
import { truthy } from "./scenes/columns";
import { PASS_COLUMN } from "./steps";

/** The match count the outer probe carries back for each row. */
export const MATCH_COLUMN = `${WALK_PREFIX}n`;
/** One correlated reference's value on the outer row, under a name the walk owns. */
export const bindColumn = (index: number): string => `${WALK_PREFIX}v${index}`;

/** A correlated reference, and where the outer probe puts the value it resolves to. */
export type BoundColumn = {
  /** As the user wrote it: `s.ID`. */
  readonly ref: string;
  readonly column: string;
};

export type BoundPlan = {
  readonly kind: "plan";
  readonly section: Section;
  readonly outer: Section;
  readonly predicate: SubqueryPredicate;
  readonly columns: readonly BoundColumn[];
  /** The outer query carrying the bound values, the verdict and the match count. */
  readonly outerSql: string;
  /**
   * The same probe with the count column left off. Counting a correlated subquery through a derived
   * table is something Postgres resolves and MySQL refuses without LATERAL, so a wrapped count can
   * fail on a query that is perfectly good; when it does, this asks the question the database can
   * always answer and the view says the count is missing rather than blaming the user.
   */
  readonly verdictSql: string;
  /** Null when no honest count could be asked for; the verdict still holds. */
  readonly counting: string | null;
  /** The count came from the derived-table wrap, which is the shape MySQL may reject. */
  readonly wrapped: boolean;
  readonly dialect: Dialect;
  /** Where each correlated reference is written in the section's own text. */
  readonly refs: readonly { readonly ref: string; readonly range: Range }[];
  /** The select list may be widened to `*`: see `boundRowSql`. */
  readonly star: boolean;
};

/** A bound section the walk cannot probe on its own, and the sentence that says why. */
export type BoundBlocked = { readonly kind: "blocked"; readonly reason: string };

/**
 * How to probe `section` per row, or why it cannot be.
 *
 * The refusals are all honest limits rather than failures. The big one is NESTING: in the relational
 * division query the inner `not exists takes` is bound to a section that is itself bound, so there
 * is no table of outer rows to scrub through — its outer rows only exist once a row of ITS outer
 * section has been picked. Binding two levels at once is a different feature; saying so is better
 * than showing a query that cannot run.
 */
export function boundPlan(program: Program, section: Section): BoundPlan | BoundBlocked {
  const { binding, origin } = section;
  if (binding.kind !== "bound") {
    return { kind: "blocked", reason: "This section does not run per row." };
  }
  const outer = sectionById(program, binding.outer);
  if (!outer) {
    return { kind: "blocked", reason: "The section it runs for is not part of this walk." };
  }
  if (outer.binding.kind === "bound") {
    return {
      kind: "blocked",
      reason: `${outer.label} is itself run once per row, so its rows only exist once a row of the section above IT has been bound. This subquery needs its parent's row first.`,
    };
  }
  if (origin.kind !== "predicate") {
    return {
      kind: "blocked",
      reason: `This is not a subquery predicate of ${outer.label}, so there is no expression to splice a count back into.`,
    };
  }
  const host = outer.parsed;
  const body = section.parsed;
  // A result-only section has no sliced clauses at all, so there is no select list to widen and no
  // correlated reference to find a range for. It cannot be probed per row, and saying so is better
  // than probing it once and printing an answer that is true of no outer row.
  if (host === null || body === null) {
    return {
      kind: "blocked",
      reason: "This section has no clauses to splice a per-row count into, so it can only be shown as it was written.",
    };
  }
  if (isSetOp(host) || isSetOp(body)) {
    return {
      kind: "blocked",
      reason: "A set operation has no single select list to hang the per-row count off.",
    };
  }

  const predicate = origin.predicate;
  const dialect = program.dialect;
  const columns = binding.columns.map((ref, index) => ({ ref, column: bindColumn(index) }));
  // The portable splice first: it leaves the correlation exactly where the user wrote it and asks
  // nothing of the dialect. The wrap is the fallback, and a subquery that already collapses to one
  // row gets no count at all rather than a `1` that means nothing.
  const rewrite = countingRewrite(predicate);
  const wrap = rewrite === null && !collapsesToOneRow(predicate) ? countingWrap(predicate) : null;
  const counting = rewrite ?? wrap;

  const verdictSql = outerProbeSql(host, predicate, columns, null);
  return {
    kind: "plan",
    section,
    outer,
    predicate,
    columns,
    outerSql: counting === null ? verdictSql : outerProbeSql(host, predicate, columns, counting),
    verdictSql,
    counting,
    wrapped: rewrite === null && wrap !== null,
    dialect,
    refs: refRanges(body.text, dialect, binding.columns),
    star: canWiden(body, predicate.kind),
  };
}

/**
 * The outer query, every row of it, each carrying what the subquery said about it.
 *
 * Two splices do the work. The predicate is replaced by `true` where it sits in the WHERE or
 * HAVING, because the rows this view is about are exactly the ones the predicate THREW AWAY — in
 * the relational-division query every student fails, so leaving the filter in place would probe an
 * empty table and teach nothing. And the select list grows three kinds of column: the correlated
 * values, so a row can be bound without asking the database a second time; the predicate itself as
 * a boolean, which is the verdict for every predicate kind and is never derived from the count; and
 * the count, when one could honestly be asked for.
 *
 * The verdict is asked for separately rather than read off the count on purpose. `x in (select …)`
 * passes when x is among the values, which the NUMBER of rows the subquery returned says nothing
 * about — reading a membership test off a row count would be confidently wrong on every IN.
 */
function outerProbeSql(
  outer: ParsedSelect,
  predicate: SubqueryPredicate,
  columns: readonly BoundColumn[],
  counting: string | null,
): string {
  const text = outer.text.slice(predicate.range.from, predicate.range.to);
  // The closing parenthesis goes on its own line every time: a `-- comment` on the last line of the
  // user's predicate would otherwise swallow the `) as …` that follows it.
  const list = [
    outer.text.slice(outer.selectList.from, outer.selectList.to),
    ...columns.map((column) => `(${column.ref}) as ${column.column}`),
    `(${text}\n) as ${PASS_COLUMN}`,
    ...(counting === null ? [] : [`(${counting}\n) as ${MATCH_COLUMN}`]),
  ];
  return spliceRanges(outer.text, outer.statement, [
    { range: outer.selectList, with: list.join(", ") },
    { range: predicate.range, with: "true" },
  ]);
}

/**
 * Whether the subquery's select list can be widened to `*` for the per-row probe.
 *
 * EXISTS throws the select list away — `select 1` and `select *` are the same question to it — so
 * showing the columns instead of a column of `1`s costs nothing and is the difference between "one
 * row came back" and "CS-319 came back". For IN and for a scalar comparison the list is the VALUE
 * being compared, so it stays exactly as written. GROUP BY, HAVING, DISTINCT and a WINDOW clause
 * all make `*` either illegal or a different query, so they rule it out too.
 */
function canWiden(parsed: ParsedSelect, kind: SubqueryPredicateKind): boolean {
  if (kind !== "exists" && kind !== "not exists") return false;
  return (
    parsed.groupBy === null &&
    parsed.having === null &&
    parsed.distinct === null &&
    parsed.window === null
  );
}

/**
 * The subquery as it runs for ONE outer row: every correlated reference replaced by that row's
 * value. This is the departure the file header names, and the SQL the reader is meant to look at.
 */
export function boundRowSql(plan: BoundPlan, row: BoundRow): string {
  // `boundPlan` refuses both of these, so a plan can never carry one; the guard is what keeps that
  // promise readable here rather than asserted with a `!`.
  const parsed = plan.section.parsed;
  if (parsed === null || isSetOp(parsed)) return plan.section.text;
  // The literals come off the row rather than being spelled again here, so what the SQL says and
  // what the narrator quotes can never drift apart by a quote mark.
  const edits = plan.refs.map((found) => ({
    range: found.range,
    with: row.literals.get(found.ref) ?? "null",
  }));
  if (plan.star) edits.push({ range: parsed.selectList, with: "*" });
  return spliceRanges(parsed.text, parsed.statement, edits);
}

/**
 * One database value, spelled so the database reads it back as the same value.
 *
 * NULL is spelled `null` and NOT turned into an `IS NULL` test. Rewriting it would be a lie: the
 * database really does evaluate `takes.ID = null` to unknown and match nothing, and a walk that
 * quietly repaired the comparison would hide the exact reason an outer row with a null came back
 * empty. The view says so in words instead — see `BoundRow.nulls` and `boundNullSentence`.
 *
 * Every other case is about not breaking the statement. A quote inside a string is doubled, which
 * is the one escape both dialects agree on; MySQL additionally treats a backslash as an escape
 * character by default, so a value holding one has to be doubled there or the rest of the literal
 * shifts by a character. Dates and timestamps reach the UI as strings and are quoted as strings,
 * which is what both dialects parse back into a date.
 */
export function sqlLiteral(value: Cell, dialect: Dialect, column?: ResultColumn): string {
  if (value === null) return "null";
  if (typeof value === "boolean") {
    // MySQL has no boolean type: TRUE and FALSE are spellings of 1 and 0, and 1 and 0 are what a
    // driver hands back, so writing them is writing what MySQL would compare against.
    return dialect === "mysql" ? (value ? "1" : "0") : value ? "true" : "false";
  }
  // A non-finite number cannot be written as a bare numeric literal in either dialect, so it goes
  // back as the quoted text the database itself spells it with.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : quote(String(value), dialect);
  // A BIGINT or NUMERIC arrives as a STRING, because neither fits a JS number without losing
  // digits. Quoting it would still compare equal — both dialects cast — but it would put
  // `year = '2009'` on screen for an integer column, and the whole point of this SQL is that it
  // reads like something a person would have written. The driver's own type name is what settles
  // it, and the shape check is there so a text column full of digits is never unquoted by mistake.
  if (column !== undefined && NUMERIC_TYPES.has(column.type) && NUMERIC_TEXT.test(value)) return value;
  return quote(value, dialect);
}

/** Driver type names that hold a number, from both drivers' own naming. */
const NUMERIC_TYPES = new Set([
  "int2", "int4", "int8", "float4", "float8", "numeric",
  "decimal", "newdecimal", "tiny", "short", "long", "longlong", "int24", "float", "double",
]);

const NUMERIC_TEXT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

function quote(value: string, dialect: Dialect): string {
  const escaped = dialect === "mysql" ? value.replace(/\\/g, "\\\\") : value;
  return `'${escaped.replace(/'/g, "''")}'`;
}

/** One row of the outer section, with everything the outer probe learned about it. */
export type BoundRow = {
  /** Stable across every rebuild of the scene: the outer sample is fetched once and never reordered. */
  readonly key: string;
  /** The correlated reference → the outer row's value for it. */
  readonly values: ReadonlyMap<string, Cell>;
  /** The same values as the literals the per-row probe writes, for the narrator and the card title. */
  readonly literals: ReadonlyMap<string, string>;
  /** Rows the subquery returned for this row, or null when no honest count could be asked for. */
  readonly matches: number | null;
  /** The predicate itself, evaluated by the database for this row — never derived from the count. */
  readonly pass: boolean;
  /** The correlated references that are null here, which is why the subquery can match nothing. */
  readonly nulls: readonly string[];
};

/**
 * The outer probe's rows, read back into what the view needs.
 *
 * A column is found by NAME rather than by position, because the walk's own columns are appended to
 * a select list that may be `*`: the position of `_perch_walk_n` then depends on how many columns
 * the user's tables happen to have, which is not something this can know.
 */
export function boundRows(plan: BoundPlan, result: StatementResult): BoundRow[] {
  const at = (name: string): number =>
    result.columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());
  const passAt = at(PASS_COLUMN);
  const matchAt = at(MATCH_COLUMN);
  const valueAt = plan.columns.map((column) => at(column.column));

  return result.rows.map((row, index) => {
    const values = new Map<string, Cell>();
    const literals = new Map<string, string>();
    plan.columns.forEach((column, position) => {
      const found = valueAt[position] ?? -1;
      const value = found < 0 ? null : (row[found] ?? null);
      values.set(column.ref, value);
      literals.set(column.ref, sqlLiteral(value, plan.dialect, result.columns[found]));
    });
    // `count(*)` is never null, but a cell that somehow is must not become a confident 0.
    const raw = matchAt < 0 ? null : (row[matchAt] ?? null);
    const count = raw === null ? null : Number(raw);
    return {
      key: `outer:${index}`,
      values,
      literals,
      matches: count === null || !Number.isFinite(count) ? null : count,
      // A predicate that evaluates to NULL — `x not in (…)` over a column holding nulls — is not
      // true, and a WHERE drops the row exactly as it drops a false one. So anything that is not
      // truthy is a fail, which is what the database did.
      pass: passAt >= 0 && truthy(row[passAt]),
      nulls: plan.columns.flatMap((column) => (values.get(column.ref) === null ? [column.ref] : [])),
    };
  });
}

