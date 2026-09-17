// A doubly-correlated subquery as a GRID, and the one probe that fills it.
//
// A correlated predicate's result is a table indexed by the outer row, which is what the per-row
// ledger shows. A DOUBLY correlated one — a subquery that walks its own rows and asks a third table
// about each of them — is indexed by TWO rows, so it is a grid: outer rows down the side, the
// middle query's driving rows across the top, and one cell per pair. The loop stops being the
// picture; the scrubber stays as nothing more than the row cursor.
//
// The tie back to what already shipped: the count the per-row probe brings back (`_perch_walk_n`)
// is exactly the ROW-SUM of this grid. Zhang's 3 is three cells. The grid shows what the count was
// counting — measured, on the Silberschatz data, for all 13 students.
//
// EVERY FRAGMENT IS A RANGE. The probe below is sliced out of the outer section's text and the
// middle section's text and glued back together; the only things the walk writes are its own
// `_perch_walk_` aliases, the word `true`, a comma and an ORDER BY over its own aliases — each of
// which it already writes elsewhere. No literal appears in the grid probe. Literals appear only in
// the per-cell SQL, which is the sanctioned departure and where the lesson lives.

import type { Dialect } from "@perch/protocol";
import {
  canWidenSelectList,
  normalizeRef,
  refRanges,
  spliceRanges,
  splitRef,
  subqueryPredicates,
  type ParsedSelect,
  type Range,
  type SubqueryPredicate,
  type SubqueryPredicateKind,
} from "./clauses";
import { bindColumn, CELL_COLUMN, driveColumn, PASS_COLUMN } from "./steps";

/** A correlated reference, and the column the probe puts its value in. */
type GridBind = { readonly ref: string; readonly column: string };

export type GridBuild = {
  /** The predicate the grid absorbs: it gets no chapter, and appears as the cells instead. */
  readonly inner: SubqueryPredicate;
  /** The inner predicate exactly as written, for the legend and for the per-cell SQL. */
  readonly innerText: string;
  /** The condition inside it — `takes.ID = s.ID and takes.course_id = rc.course_id`. */
  readonly innerCondition: string | null;
  /** The table the inner predicate reads: `takes`. */
  readonly innerSource: string;
  /** The outer row's bound values, the same columns the per-row ledger already carries. */
  readonly columns: readonly GridBind[];
  /** The middle's own driving keys, one per grid column axis: `rc.course_id`. */
  readonly drives: readonly GridBind[];
  /** The middle's FROM source as written: `RequiredCourses rc`. */
  readonly driveTitle: string;
  /** A noun for one driving row, read off the driving key: `course_id` → `course`. */
  readonly driveNoun: string;
  /** A noun for one outer row: the outer query's first source, `student`. */
  readonly rowNoun: string;
  readonly middleKind: SubqueryPredicateKind;
  readonly innerKind: SubqueryPredicateKind;
  /** The one probe. Outer rows × driving rows, ordered outer-first. */
  readonly sql: string;
  readonly dialect: Dialect;
  /** The inner statement on its own, for splicing a picked cell's literals into. */
  readonly innerStatement: { readonly text: string; readonly range: Range };
  /** The WITH prefix the inner statement needs when it is run on its own. */
  readonly prefix: string;
  /** The inner's select list, when it may be widened to `*` for the cell card. */
  readonly innerList: Range | null;
};

/** Grid columns shown before the rest fold into a `+n` marker, as `capCols` folds a wide card. */
export const MAX_DRIVE_COLS = 12;

/** Outer rows the grid shows, which is the sample size every other card here uses. */
const MAX_GRID_ROWS = 25;

/**
 * Cells one probe may ask for.
 *
 * `MAX_GRID_ROWS × MAX_DRIVE_COLS` is the grid at its widest, and past that the columns have already
 * folded, so asking for more would buy nothing a reader can see. The ORDER BY puts the outer key
 * first for this reason alone: a cut at 300 then falls BETWEEN outer rows, so the rows that arrive
 * are whole and the ones that did not arrive are simply absent. Cutting mid-row would leave a
 * student with three of their five courses and no way to tell that from a student with three.
 */
export const MAX_GRID_CELLS = Math.min(300, MAX_GRID_ROWS * MAX_DRIVE_COLS);

/** The predicate kinds whose verdict is a statement about the NUMBER of rows, and nothing else. */
const COUNTING_KINDS = new Set<SubqueryPredicateKind>(["exists", "not exists"]);

/** The kinds that are true when the subquery found NOTHING, which is what flips a cell's glyph. */
const NEGATIVE_KINDS = new Set<SubqueryPredicateKind>(["not exists", "not in"]);

export const isNegativeKind = (kind: SubqueryPredicateKind): boolean => NEGATIVE_KINDS.has(kind);

/**
 * How one cell bears on the OUTER row's verdict.
 *
 * This is the thing that is easy to get backwards, so it is derived rather than reasoned about, and
 * it depends on the MIDDLE predicate alone. A cell is `true` exactly when the inner predicate held,
 * which is exactly when the middle subquery RETURNS that driving row — and a returned row is what
 * `exists` is looking for and what `not exists` cannot allow. The inner kind decides what the cell
 * says about the table (see `cellFound`), never what it does to the verdict.
 *
 * Measured on all four combinations against the Silberschatz data: for every one of the 13 students,
 * `pass` equalled `not exists ? row-sum = 0 : row-sum > 0`.
 */
export type CellTone = "gap" | "save" | "quiet";

export function cellTone(returned: boolean, middleKind: SubqueryPredicateKind): CellTone {
  if (!returned) return "quiet";
  return isNegativeKind(middleKind) ? "gap" : "save";
}

/** Whether the inner subquery FOUND rows, which is what the filled dot means. A negative predicate
 *  is true when it found none, so the cell's boolean is the opposite of what the reader sees. */
export function cellFound(returned: boolean, innerKind: SubqueryPredicateKind): boolean {
  return isNegativeKind(innerKind) ? !returned : returned;
}

/**
 * Why there is no grid, in the reader's terms.
 *
 * A refusal is never a failure — the per-row LEDGER is a complete picture and every one of these
 * lands on it. But "complete" is not the same as "expected": a reader who has seen a grid on one
 * query and a ledger on the next is owed the sentence saying which clause moved the line, because
 * the alternative is believing the walk simply gives up at random. The reasons name the CLAUSE
 * responsible rather than the internal rule, since the clause is the thing the reader can change.
 */
export type GridRefusal = {
  readonly kind: "none";
  readonly reason: string;
  /**
   * Whether this query was ever a grid candidate: whether it is DOUBLY correlated at all.
   *
   * It decides whether the reason is worth showing. Every per-row section is correlated — that is
   * why it runs per row — so a note on each one saying "this is not a grid" would appear on almost
   * every bound chapter and answer a question nobody asked. False means the grid was never on the
   * table and the ledger is simply the picture; true means it nearly was, and the clause named in
   * `reason` is what moved the line.
   */
  readonly candidate: boolean;
};

/** A grid, or the stated reason there is none. */
export type GridOutcome = { readonly kind: "grid"; readonly grid: GridBuild } | GridRefusal;

/** For the callers that only want to know whether a grid exists. */
export function gridOf(outcome: GridOutcome): GridBuild | null {
  return outcome.kind === "grid" ? outcome.grid : null;
}

const no = (reason: string, candidate = true): GridRefusal => ({ kind: "none", reason, candidate });

/**
 * The grid for a per-row section, or the reason the ledger is the right picture instead.
 *
 * `program.ts` calls this to decide whether the inner predicate gets a chapter of its own, and the
 * view calls it to build the probe. Both must reach the same answer from the same text, which is
 * why it is one function and why it takes parses rather than sections.
 */
export function gridBuild(args: {
  /** The section whose rows the per-row section runs for. */
  readonly outer: ParsedSelect;
  /** The per-row section itself: the middle query. */
  readonly middle: ParsedSelect;
  /** The middle as it sits in the outer's WHERE: `not exists (select … )`. */
  readonly predicate: SubqueryPredicate;
  /** The middle's correlated references, in the order the ledger's bind columns follow. */
  readonly correlated: readonly string[];
  readonly dialect: Dialect;
  /** The WITH prefix already spliced into the middle's text. */
  readonly prefix: string;
}): GridOutcome {
  const { outer, middle, predicate, correlated, dialect, prefix } = args;

  // FIRST: is this a grid-shaped question at all? A grid draws a DOUBLY correlated subquery — one
  // that walks its own rows and asks a third table about each of them. Everything below describes
  // why a grid could not be DRAWN, which is only worth saying to a reader who could have expected
  // one, so the two tests that decide whether it was ever a candidate run before any of them.
  if (middle.where === null) {
    return no(
      "The subquery has no WHERE, so there is no per-pair condition for a cell to answer.",
      false,
    );
  }
  const inner = onlyInner(middle, dialect);
  if (inner === null) {
    return no(
      "A grid is the picture for a DOUBLY correlated subquery — one that walks its own rows and asks a third table about each of them. This one has no single inner predicate to put in the cells.",
      false,
    );
  }

  // A verdict that counts rows is the only one a cell can bear on. `x in (select …)` passes when a
  // returned row HOLDS a value, so a cell that says "this row came back" would not say whether it
  // was the one that mattered — and tinting it either way would be a guess.
  if (!COUNTING_KINDS.has(predicate.kind)) {
    return no(
      `A grid needs a subquery whose verdict is about the NUMBER of rows it found. This one is an ${predicate.kind.toUpperCase()}, which passes when a returned row HOLDS a value — a cell saying "a row came back" would not say whether it was the one that mattered.`,
    );
  }

  // The shapes `countingRewrite` already refuses, refused again for the same reason: each one makes
  // the middle's rows something other than "one row per driving row", which is what a column is.
  if (middle.groupBy !== null || middle.having !== null) {
    return no(
      "The subquery groups its rows, so it does not return one row per driving row — and one row per driving row is what a grid column IS.",
    );
  }
  if (middle.distinct !== null || middle.window !== null) {
    const which = middle.distinct !== null ? "DISTINCT" : "window function";
    return no(
      `The subquery's ${which} changes which rows it returns, so they no longer line up one-to-one with the driving rows a grid column stands for.`,
    );
  }
  if (middle.limit !== null || middle.offset !== null) {
    return no(
      "The subquery caps its own rows, so which ones survive depends on an order the grid cannot show. The ledger counts what actually came back instead.",
    );
  }
  // A join has a row set the header cannot name: the column axis would be pairs, not courses.
  if (middle.joins.length > 0) {
    return no(
      "The subquery joins, so its rows are PAIRS. A grid's column axis has to be one named thing across the top, and a pair has no such name.",
    );
  }
  // A derived table in the middle's FROM would be spliced into the OUTER's FROM, where SQL forbids
  // it from seeing the outer row — and a `(select …) d` that never needed to is still a subquery
  // the reader has no name for across the top of a grid.
  if (middle.first.kind === "derived") {
    return no(
      "The subquery reads a derived table. The grid probe would have to splice it into the outer FROM, where SQL forbids it from seeing the outer row.",
    );
  }

  // The outer query's own shape has to survive one extra source in its FROM and one extra pair of
  // conditions in its WHERE. Grouping, DISTINCT and a row cap all mean something different once the
  // rows have been multiplied by the driving rows, so none of them can ride along.
  if (outer.groupBy !== null || outer.having !== null) {
    return no(
      "The outer query groups its rows. A grid multiplies those rows by the driving rows first, which would change what each group contains.",
    );
  }
  if (outer.distinct !== null || outer.window !== null) {
    const which = outer.distinct !== null ? "DISTINCT" : "window function";
    return no(
      `The outer query's ${which} means something different once its rows have been multiplied by the driving rows, so it cannot ride along in the grid probe.`,
    );
  }
  if (outer.limit !== null || outer.offset !== null) {
    return no(
      "The outer query caps its rows, and the grid probe returns one row per PAIR — so the cap would cut somewhere the reader never asked for.",
    );
  }
  if (outer.where === null) {
    return no("The outer query has no WHERE for the grid probe to splice the predicate out of.");
  }
  // The predicate is spliced to `true` where it sits, so it has to sit in the WHERE we are splicing.
  if (predicate.range.from < outer.where.body.from || predicate.range.to > outer.where.body.to) {
    return no(
      "The subquery is nested inside a larger expression in the outer WHERE, and the grid probe can only neutralise a predicate it can find whole.",
    );
  }
  // A CTE the middle declares for itself is not in the outer's WITH, and the probe is built from the
  // outer's statement, so it would be out of scope by the time the cell expression asked for it.
  const known = new Set(outer.ctes.map((cte) => cte.name.toLowerCase()));
  if (middle.ctes.some((cte) => !known.has(cte.name.toLowerCase()))) {
    return no(
      "The subquery declares a WITH of its own, which is out of scope in the outer statement the grid probe is built from.",
    );
  }

  // A scalar's "found" is not a fact about rows at all — it is whether a comparison held — so there
  // is no honest glyph for it, and a grid of cells whose meaning cannot be stated is worse than the
  // ledger it replaced.
  if (inner.kind === "scalar") {
    return no(
      "The inner subquery compares a VALUE rather than looking for rows, so a cell has no honest glyph — and a grid whose cells cannot be stated is worse than the ledger it would replace.",
    );
  }
  if (inner.parsed.kind !== "select") {
    return no(
      "The inner subquery could not be sliced into clauses, so there is no cell expression to build.",
    );
  }

  // The correlated references, split by who defines them: the middle's own source drives the
  // columns, and everything else must be one of the values the outer row already binds.
  const own = new Set([middle.first.alias ?? middle.first.name].map((name) => name.toLowerCase()));
  const bound = new Map(correlated.map((ref, index) => [normalizeRef(ref), bindColumn(index)]));
  const drives: GridBind[] = [];
  for (const ref of inner.correlated) {
    const qualifier = splitRef(ref).qualifier?.toLowerCase() ?? null;
    if (qualifier !== null && own.has(qualifier)) {
      if (!drives.some((drive) => normalizeRef(drive.ref) === normalizeRef(ref))) {
        drives.push({ ref, column: driveColumn(drives.length) });
      }
      continue;
    }
    // A reference to neither the driving row nor the outer row points further out still — three
    // levels of correlation, which this grid has no axis for.
    if (!bound.has(normalizeRef(ref))) {
      return no(
        `\`${ref}\` points past both the driving row and the outer row — three levels of correlation, and a grid has two axes.`,
      );
    }
  }
  // Without a driving key the inner does not vary across the columns, so every cell in a row would
  // hold the same value and the grid would be a ledger drawn wide.
  if (drives.length === 0) {
    return no(
      "The inner subquery never mentions the subquery's own rows, so every cell in a row would hold the same value — a ledger drawn wide, not a grid.",
    );
  }

  const columns: GridBind[] = correlated.map((ref, index) => ({
    ref,
    column: bindColumn(index),
  }));

  // The column axis has to be the SAME for every outer row, because it is drawn once across the top
  // of the card. It is, exactly when the middle's own filter says nothing about the outer row: the
  // driving rows are then a fixed table and the cells are what vary. `takes t where t.ID = s.ID and
  // not exists (…)` is the shape this catches — every student would have a different set of columns,
  // and a grid of mostly-absent cells is a worse picture than the ledger it replaced.
  const outward = refRanges(middle.text, dialect, correlated).filter(
    (found) =>
      found.range.from >= middle.where!.body.from &&
      found.range.to <= middle.where!.body.to &&
      !(found.range.from >= inner.range.from && found.range.to <= inner.range.to),
  );
  if (outward.length > 0) {
    return no(
      "The subquery's own filter mentions the outer row, so each outer row would have a DIFFERENT set of columns — and the column axis is drawn once, across the top, for all of them.",
    );
  }

  const cut = (text: string, range: Range): string => text.slice(range.from, range.to);

  const innerText = cut(middle.text, inner.range);
  const driveRange = cut(middle.text, middle.first.range);
  // The middle's OTHER conjuncts have to survive as real conditions: `where rc.credits > 3 and not
  // exists (…)` keeps `rc.credits > 3`, because the courses it throws away are not columns of this
  // grid. Only the inner predicate is neutralised, and only because the cells are what measure it.
  const middleWhere = spliceRanges(middle.text, middle.where.body, [
    { range: inner.range, with: "true" },
  ]);
  const outerWhere = spliceRanges(outer.text, outer.where.body, [
    { range: predicate.range, with: "true" },
  ]);

  const list = [
    cut(outer.text, outer.selectList),
    ...columns.map((column) => `(${column.ref}) as ${column.column}`),
    ...drives.map((drive) => `(${drive.ref}) as ${drive.column}`),
    // The closing parenthesis on its own line every time: a `-- comment` on the last line of the
    // user's predicate would otherwise swallow the `) as …` that follows it.
    `(${innerText}\n) as ${CELL_COLUMN}`,
    `(${cut(outer.text, predicate.range)}\n) as ${PASS_COLUMN}`,
  ].join(", ");

  const order = [...columns, ...drives].map((bind) => bind.column).join(", ");
  const sql = `${spliceRanges(outer.text, outer.statement, [
    { range: outer.selectList, with: list },
    // A zero-width edit at the end of the FROM list: the driving source joins it as one more
    // comma source, which is what "once per row of RequiredCourses" means spelled as a table.
    {
      range: { from: outer.from.to, to: outer.from.to },
      with: `, ${driveRange}`,
    },
    { range: outer.where.body, with: `(${outerWhere}) and (${middleWhere})` },
    // Ours replaces theirs: the outer's ORDER BY sorts rows the grid is about to index by key, and
    // two ORDER BY clauses in one statement is a syntax error rather than a compromise.
    ...(outer.orderBy ? [{ range: outer.orderBy.range, with: "" }] : []),
  ])}\norder by ${order}`;

  return {
    kind: "grid",
    grid: {
      inner,
      innerText,
      innerCondition: inner.parsed.where ? cut(middle.text, inner.parsed.where.body) : null,
      innerSource: inner.parsed.first.name,
      columns,
      drives,
      driveTitle: driveRange,
      driveNoun: nounFor(drives[0]!.ref, middle.first.name),
      rowNoun: outer.first.name,
      middleKind: predicate.kind,
      innerKind: inner.kind,
      sql,
      dialect,
      innerStatement: { text: middle.text, range: inner.parsed.statement },
      prefix,
      innerList: canWidenSelectList(inner.parsed, inner.kind) ? inner.parsed.selectList : null,
    },
  };
}

/**
 * The one subquery predicate in the middle's WHERE that the grid can absorb.
 *
 * Exactly one, and it has to be correlated. Two of them would need two grids — or one grid whose
 * cells held two answers — and a WHERE with a correlated predicate beside an uncorrelated one is
 * still two different questions about the same driving row.
 */
function onlyInner(middle: ParsedSelect, dialect: Dialect): SubqueryPredicate | null {
  if (middle.where === null) return null;
  const found = subqueryPredicates(middle.text, middle.where.body, dialect);
  if (found.length !== 1) return null;
  const inner = found[0]!;
  return inner.correlated.length > 0 ? inner : null;
}

/** `rc.course_id` → `course`, `rc.dept_name` → `dept name`, and the source's own name when the key
 *  says nothing useful. It is only ever used as a noun in a sentence, never as SQL. */
function nounFor(ref: string, fallback: string): string {
  const column = splitRef(ref).column.replace(/_?id$/i, "");
  return column === "" ? fallback : column.replace(/_/g, " ");
}
