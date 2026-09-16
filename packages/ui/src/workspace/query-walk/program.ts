// One query, read as a PROGRAM of sections rather than a single walk.
//
// A section is a named intermediate result with its own full station walk: a CTE, a derived table, a
// subquery predicate, a branch of a set operation, or the statement itself. They are emitted
// depth-first, so a section always lands after everything it reads and the chapter strip can be read
// top to bottom. Nothing is a detour any more — a later section REFERENCES an earlier one by name
// instead of recomputing it.
//
// CORRELATION is the property that decides everything. A subquery that does not depend on the outer
// row computes once and is its own standalone section; one that does runs per outer row, and is
// `bound` to the section whose rows it re-runs for.
//
// The trap: `SubqueryPredicate.correlated` only reports QUALIFIED references, because `course_id`
// with no table in front of it cannot be resolved without a catalogue. So an empty list means "no
// PROVABLE correlation", never "uncorrelated" — promoting such a subquery to a standalone section
// would run it once and show a confidently wrong result. That uncertainty is not flattened here: it
// is carried as `Binding.certain`, for a later wave to settle by probing.
//
// Every section's `parsed.text` is a COMPLETE, self-contained query: the WITH prefix in scope is
// spliced onto the body and the whole thing re-parsed, so a section's ranges index its own text and
// a probe built from it needs nothing prepended. `prefix` records what was spliced on.

import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import type { Dialect } from "@perch/protocol";
import {
  countingRewrite,
  isSetOp,
  isUnsupported,
  parseStatement,
  statementShape,
  subqueryPredicates,
  type Cte,
  type ParsedSelect,
  type ParsedSetOp,
  type Range,
  type SetBranch,
  type SourceRef,
  type SubqueryPredicate,
  type Unsupported,
} from "./clauses";

export type SectionId = string;

export type SectionOrigin =
  | { readonly kind: "cte"; readonly cte: Cte }
  | { readonly kind: "derived"; readonly source: SourceRef }
  | { readonly kind: "predicate"; readonly predicate: SubqueryPredicate }
  | { readonly kind: "branch"; readonly index: number; readonly branch: SetBranch }
  | { readonly kind: "main" };

export type Binding =
  | {
      readonly kind: "standalone";
      /**
       * False when correlation could not be RULED OUT by parsing alone, so it must be confirmed by
       * probing: the subquery filters on a column nobody qualified, or it is a LATERAL derived
       * table. True only when the SQL itself settles it.
       */
      readonly certain: boolean;
    }
  | {
      readonly kind: "bound";
      /**
       * The section whose rows this one runs once per. It is NOT a `reads` dependency and it may
       * appear LATER in `Program.sections`: a per-row subquery is built before the query that
       * drives it, the way a footnote is printed before the page that cites it.
       */
      readonly outer: SectionId;
      /** The correlated references, as written: `student.ID`. */
      readonly columns: readonly string[];
    };

/**
 * Why a section produces a table but has no clause sequence to step through.
 *
 * These are not failures. A `VALUES` list, a `select` with no FROM and a data-modifying `RETURNING`
 * CTE all run on the database and all hand back real rows — there is simply no FROM → WHERE →
 * SELECT order inside them for the walk to animate. Before this existed each one was dropped as
 * "unsupported", which told the reader their CTE was not part of the query when in fact it is the
 * first thing that runs.
 */
export type ResultOnlyKind =
  /** `values (1),(2)`, or `table student`: a whole table written in one word. */
  | "values"
  /** `select 1 as n`: expressions computed once, over no rows at all. */
  | "no-from"
  /** `delete … returning *`: it changes the database, so the walk shows it and never runs it. */
  | "writes";

export type ResultOnly = {
  readonly kind: ResultOnlyKind;
  /**
   * The statement WITHOUT the WITH prefix the slicer spliced onto it: what the user wrote for this
   * section and nothing else. `Section.text` is what runs; this is what the narrator quotes, so a
   * two-line `values` list is not introduced by the fifty lines of CTEs that happen to precede it.
   */
  readonly body: string;
  /** `insert`, `update`, `delete`, `merge` — for `writes` only, so the chapter can name the verb. */
  readonly verb: string | null;
  /** What the clause slicer said when it refused, kept so the chapter can stay honest about it. */
  readonly reason: string;
};

export type Section = {
  readonly id: SectionId;
  /** Human-readable, stable, and unique within the program. Shown in the chapter strip. */
  readonly label: string;
  readonly origin: SectionOrigin;
  /**
   * The section as a standalone statement. A set operation stays a `ParsedSetOp`: its branches are
   * sections of their own and this is the node that combines them.
   *
   * Null exactly when `result` is set: the slicer refused the body and the section runs as one
   * station instead of ten. Read `text` rather than `parsed.text` when all you want is the SQL.
   */
  readonly parsed: ParsedSelect | ParsedSetOp | null;
  /** The complete statement this section runs, WITH prefix and all. Always present. */
  readonly text: string;
  /** Set when the section has no clause sequence to walk; null for every ordinary section. */
  readonly result: ResultOnly | null;
  /**
   * Running this section's text would CHANGE the database, so nothing may ever probe it.
   *
   * This is true of far more sections than the write itself. Every probe the walk builds carries
   * the section's whole WITH prefix, so in `with d as (delete from takes returning *) select * from
   * d` it is not only `d` that deletes — the final query's FROM, WHERE and SELECT probes each
   * splice that same prefix in and delete again, thirty times over. The flag is therefore set from
   * the section's OWN composed text, which is exactly what would be sent.
   */
  readonly unsafeToProbe: boolean;
  readonly binding: Binding;
  /** Sections this one reads. Every id here appears EARLIER in `Program.sections`. */
  readonly reads: readonly SectionId[];
  /** The `WITH …\n` prefix already spliced into `parsed.text`. Empty when none. */
  readonly prefix: string;
};

/**
 * A piece of the query that did not become a section, kept so a later wave can say "this part could
 * not be walked" instead of silently dropping it.
 *
 * `unsupported` is a parse the slicer refused. `inline` is a deliberate choice: see the rule about
 * unprobeable correlated scalar aggregates in `predicateBinding`.
 */
export type SkippedPart = {
  readonly why: "unsupported" | "inline";
  readonly label: string;
  readonly reason: string;
  /** The SQL that would have been the section, for showing what was left out. */
  readonly sql: string;
};

export type Program = {
  readonly text: string;
  readonly dialect: Dialect;
  /** Topologically sorted: a section only ever reads sections before it. */
  readonly sections: readonly Section[];
  /** The section holding the query's final result. */
  readonly mainId: SectionId;
  /** Set when the statement's top level is a set operation; its branches are sections. */
  readonly setOp: ParsedSetOp | null;
  readonly skipped: readonly SkippedPart[];
};

/* ---------------------------------------------------------------------------------------------- */

/** The CTEs a section can see, and the sections that already compute them. */
type Scope = {
  /** Each CTE as the user wrote it (`name as (…)`), oldest first. */
  readonly ctes: readonly string[];
  /** The WITH said RECURSIVE, so every prefix rebuilt from it has to say so too. */
  readonly recursive: boolean;
  /**
   * Lower-cased CTE name → the section that computes it, or null when it could not be sliced. A
   * refused CTE is still REMEMBERED: it is in every descendant's prefix, and without this each one
   * would try to build it again and report the same failure over and over.
   */
  readonly known: ReadonlyMap<string, SectionId | null>;
};

const EMPTY_SCOPE: Scope = { ctes: [], recursive: false, known: new Map() };

type Build = {
  readonly dialect: Dialect;
  readonly sections: Section[];
  readonly skipped: SkippedPart[];
  /** Label → how many sections have claimed it, so the strip never shows the same name twice. */
  readonly labels: Map<string, number>;
};

export function buildProgram(text: string, dialect: Dialect): Program | Unsupported {
  // The one statement that cannot be made into a program at all. Everything else — a bare `select
  // 1`, a `VALUES` list, a CTE that writes — has SOME table to show and gets a chapter below; a
  // write with no RETURNING hands back nothing, and the walk will not run it to find out.
  const shape = statementShape(text, dialect);
  if (shape.kind === "write" && !shape.returning) {
    return {
      kind: "unsupported",
      reason: `${(shape.verb ?? "This statement").toUpperCase()} changes the database and returns no rows, so there is nothing to walk. Add a RETURNING clause to see what it touched.`,
    };
  }

  const build: Build = { dialect, sections: [], skipped: [], labels: new Map() };
  const mainId = addQuery(build, {
    sql: text,
    prefix: "",
    path: "main",
    label: "Result",
    origin: { kind: "main" },
    binding: { kind: "standalone", certain: true },
    scope: EMPTY_SCOPE,
  });
  // The main query was refused outright. Its own reason is the useful one — "This SELECT has no
  // columns" tells the reader where to look, where a generic line sends them nowhere.
  if (mainId === null) {
    const refusal = build.skipped.find((part) => part.why === "unsupported");
    return { kind: "unsupported", reason: refusal?.reason ?? "This query could not be read." };
  }

  const sections = orderSections(build.sections);
  const main = sections.find((section) => section.id === mainId);
  const parsed = main?.parsed ?? null;
  return {
    text,
    dialect,
    sections,
    mainId,
    setOp: parsed !== null && isSetOp(parsed) ? parsed : null,
    skipped: build.skipped,
  };
}

/** The section whose walk is the query's final result. */
export function mainSection(program: Program): Section | null {
  return program.sections.find((section) => section.id === program.mainId) ?? null;
}

export function sectionById(program: Program, id: SectionId): Section | null {
  return program.sections.find((section) => section.id === id) ?? null;
}

/**
 * Whether `buildProgram` refused the statement.
 *
 * `Program` carries no `kind`, so the field's mere presence settles it and neither side has to grow
 * a tag it would otherwise never read.
 */
export function isUnsupportedProgram(value: Program | Unsupported): value is Unsupported {
  return "kind" in value && value.kind === "unsupported";
}

/**
 * The section a FROM source reads, or null when the slicer never made one for it.
 *
 * A CTE is matched by NAME, not by id: a CTE declared in an ancestor is computed exactly once, and
 * every descendant that selects from it points at that single section rather than at one of its
 * own — so its id is spelled with the ancestor's path, not `from`'s. A derived table is matched by
 * range instead, because it lives in `from`'s own text and its section kept the very `SourceRef`
 * the FROM card was drawn from.
 *
 * Only `from.reads` is searched. A name that resolves to a section belonging to some unrelated part
 * of the query would be a different table that happens to share a spelling, and pointing the reader
 * at it is worse than showing nothing.
 */
export function sectionForSource(
  program: Program,
  from: Section,
  source: SourceRef,
): Section | null {
  for (const id of from.reads) {
    const read = sectionById(program, id);
    if (read === null) continue;
    if (
      source.kind === "cte" &&
      read.origin.kind === "cte" &&
      read.origin.cte.name.toLowerCase() === source.name.toLowerCase()
    ) {
      return read;
    }
    if (
      source.kind === "derived" &&
      read.origin.kind === "derived" &&
      read.origin.source.range.from === source.range.from &&
      read.origin.source.range.to === source.range.to
    ) {
      return read;
    }
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */

type AddArgs = {
  /** A complete statement: the body with its WITH prefix already spliced on. */
  readonly sql: string;
  readonly prefix: string;
  readonly path: string;
  readonly label: string;
  readonly origin: SectionOrigin;
  readonly binding: Binding;
  readonly scope: Scope;
};

/**
 * Emits one section and, before it, every section it depends on.
 *
 * Children are added first and the section itself last, which is what makes `Program.sections`
 * topologically sorted by construction: a CTE is emitted before the query that selects from it, and
 * a nested EXISTS before the EXISTS that wraps it.
 */
function addQuery(build: Build, args: AddArgs): SectionId | null {
  const { sql, prefix, path, origin, binding, scope } = args;
  const parsed = parseStatement(sql, build.dialect);
  if (isUnsupported(parsed)) return addResultOnly(build, args, parsed);

  const reads: SectionId[] = [];
  if (isSetOp(parsed)) {
    // The CTEs belong to the WHOLE set operation, not to a branch. Wave 1 seeds every branch parse
    // with them so `from monthly` resolves inside it, which meant each branch reached its own CTE
    // loop with an empty scope and built the CTE all over again — the `a 2` in the chapter strip.
    // Building them HERE, once, and handing the branches a scope that already knows them is what
    // makes every branch read the same section instead of a copy of it.
    const seeded = addCtes(build, { ctes: parsed.ctes, withRange: parsed.with, sql, path, binding, scope });
    reads.push(...seeded.reads, ...addBranches(build, parsed, sql, path, binding, seeded.scope));
  } else {
    reads.push(...addChildren(build, parsed, sql, path, binding, scope));
  }

  const id = path;
  build.sections.push({
    id,
    label: claimLabel(build, args.label),
    origin,
    parsed,
    text: sql,
    result: null,
    unsafeToProbe: carriesWrite(sql, build.dialect),
    binding,
    reads: dedupe(reads),
    prefix,
  });
  return id;
}

/**
 * A section for a body the clause slicer refused, when the body nonetheless produces a table.
 *
 * This is the whole point of wave 7. `with v as (values (1),(2)) select * from v` used to lose `v`
 * entirely — no chapter, just a note saying only SELECT queries can be walked — even though `v` is
 * the first thing the database computes and its rows are on screen a moment later under another
 * name. The section it gets has one station instead of ten, and it still carries its CTEs, because
 * a `select 1` at the end of a WITH list does not make the list stop existing.
 *
 * Returns null, and records the refusal, only when the body really is something we cannot show.
 */
function addResultOnly(build: Build, args: AddArgs, refusal: Unsupported): SectionId | null {
  const { sql, prefix, path, origin, binding, scope } = args;
  const shape = statementShape(sql, build.dialect);
  const kind: ResultOnlyKind | null =
    shape.kind === "write"
      ? "writes"
      : shape.kind === "values"
        ? "values"
        : shape.kind === "select" && !shape.from
          ? "no-from"
          : null;
  if (kind === null) {
    build.skipped.push({ why: "unsupported", label: args.label, reason: refusal.reason, sql });
    return null;
  }

  // The CTEs first, exactly as a walkable section would. They are ordinary queries with ordinary
  // walks; only the body that reads them is the odd one, and it must not take them down with it.
  const seeded = addCtes(build, { ctes: shape.ctes, withRange: shape.with, sql, path, binding, scope });
  build.sections.push({
    id: path,
    label: claimLabel(build, args.label),
    origin,
    parsed: null,
    text: sql,
    // `compose` MERGES two WITH lists rather than stacking them, so the prefix is not always a
    // literal head of `sql`; when it is not, the whole statement is the honest thing to quote.
    result: {
      kind,
      body: (prefix !== "" && sql.startsWith(prefix) ? sql.slice(prefix.length) : sql).trim(),
      verb: shape.verb,
      reason: refusal.reason,
    },
    unsafeToProbe: carriesWrite(sql, build.dialect),
    binding,
    reads: dedupe(seeded.reads),
    prefix,
  });
  return path;
}

type CteArgs = {
  readonly ctes: readonly Cte[];
  readonly withRange: Range | null;
  readonly sql: string;
  readonly path: string;
  readonly binding: Binding;
  readonly scope: Scope;
};

/**
 * The CTEs a statement declares, each its own section, and the scope that results.
 *
 * `ctes` opens with the ones an enclosing prefix spliced into `sql`, which already have sections of
 * their own; `scope.known` is what tells those apart from the ones this statement declares, and
 * skipping them is what stops a CTE in scope from being rebuilt once per statement that can see it.
 */
function addCtes(build: Build, args: CteArgs): { scope: Scope; reads: SectionId[] } {
  const { ctes, withRange, sql, path, binding, scope } = args;
  const reads: SectionId[] = [];
  const recursive =
    scope.recursive ||
    (withRange !== null && /^with\s+recursive\b/i.test(sql.slice(withRange.from, withRange.to)));

  let inner: Scope = { ...scope, recursive };
  for (const cte of ctes) {
    const key = cte.name.toLowerCase();
    if (inner.known.has(key)) continue;
    const cteText = sql.slice(cte.range.from, cte.range.to);
    const body = sql.slice(cte.body.from, cte.body.to);
    const id = mentionsWord(body, cte.name)
      ? addRecursiveCte(build, { cte, cteText, path, scope: inner })
      : addQuery(build, {
          sql: compose(body, inner, build.dialect),
          prefix: renderPrefix(inner),
          path: `${path}.cte:${cte.name}`,
          label: cte.name,
          origin: { kind: "cte", cte },
          // A CTE sits at the top of the statement, where there is no outer row to depend on, so
          // it always computes exactly once.
          binding: binding.kind === "bound" ? binding : { kind: "standalone", certain: true },
          scope: inner,
        });
    inner = {
      ctes: [...inner.ctes, cteText],
      recursive: inner.recursive,
      known: new Map([...inner.known, [key, id]]),
    };
    if (id !== null) reads.push(id);
  }
  return { scope: inner, reads };
}

/**
 * The branches of a set operation, each its own section.
 *
 * The prefix comes from `ParsedSetOp.with` and never from a branch's own `ctes`: wave 1 seeds each
 * branch parse with the statement's CTEs so `from monthly` resolves, but deliberately leaves the
 * branch's `with` null because the prefix belongs to the whole statement. Rebuilding it from the
 * branch would emit every CTE twice.
 */
function addBranches(
  build: Build,
  parsed: ParsedSetOp,
  sql: string,
  path: string,
  binding: Binding,
  scope: Scope,
): SectionId[] {
  const withText = parsed.with ? `${sql.slice(parsed.with.from, parsed.with.to)}\n` : "";
  const out: SectionId[] = [];
  parsed.branches.forEach((branch, index) => {
    const body = sql.slice(branch.range.from, branch.range.to).trim();
    const id = addQuery(build, {
      sql: `${withText}${body}`,
      prefix: withText,
      path: `${path}.branch:${index}`,
      label: `Branch ${index + 1}`,
      origin: { kind: "branch", index, branch },
      // A branch of a per-row section is itself per-row; nothing about the split changes that.
      binding,
      scope,
    });
    if (id !== null) out.push(id);
  });
  return out;
}

/** The CTEs, derived tables and subquery predicates one SELECT owns, in dependency order. */
function addChildren(
  build: Build,
  parsed: ParsedSelect,
  sql: string,
  path: string,
  binding: Binding,
  scope: Scope,
): SectionId[] {
  const seeded = addCtes(build, { ctes: parsed.ctes, withRange: parsed.with, sql, path, binding, scope });
  const inner = seeded.scope;
  const reads: SectionId[] = [...seeded.reads];

  /* FROM: a CTE reference is an edge to the section that computes it; a derived table is one more. */
  const sources = [parsed.first, ...parsed.joins.map((join) => join.source)];
  sources.forEach((source, index) => {
    if (source.kind === "cte") {
      const known = inner.known.get(source.name.toLowerCase());
      if (known) reads.push(known);
      return;
    }
    if (source.kind !== "derived" || source.body === null) return;
    // A plain derived table CANNOT see the outer query — SQL forbids it — so its independence is
    // proved by the grammar. LATERAL is exactly the opposite: it exists to see the rows beside it,
    // and whether it actually does cannot be read off the text, so it stays uncertain.
    const lateral = /\blateral\s*$/i.test(sql.slice(0, source.range.from));
    const own: Binding = { kind: "standalone", certain: !lateral };
    const id = addQuery(build, {
      sql: compose(sql.slice(source.body.from, source.body.to), inner, build.dialect),
      prefix: renderPrefix(inner),
      path: `${path}.from:${index}`,
      label: source.alias ?? source.name,
      origin: { kind: "derived", source },
      binding: binding.kind === "bound" ? binding : own,
      scope: inner,
    });
    if (id !== null) reads.push(id);
  });

  /* WHERE and HAVING: every depth-zero subquery predicate. Deeper ones surface when the section
     built here recurses into its own clauses. */
  for (const clause of [parsed.where, parsed.having]) {
    if (clause === null) continue;
    const slot = clause === parsed.where ? "where" : "having";
    subqueryPredicates(sql, clause.body, build.dialect).forEach((predicate, index) => {
      const own = predicateBinding(build, predicate, sql, path);
      if (own === null) return;
      const id = addQuery(build, {
        sql: compose(sql.slice(predicate.body.from, predicate.body.to), inner, build.dialect),
        prefix: renderPrefix(inner),
        path: `${path}.${slot}:${index}`,
        label: predicateLabel(predicate),
        origin: { kind: "predicate", predicate },
        // A subquery nested inside a per-row section is itself per-row, even when nothing in its
        // own text is correlated: it cannot run until the row above it exists.
        binding: own.kind === "bound" || binding.kind !== "bound" ? own : binding,
        scope: inner,
      });
      if (id !== null) reads.push(id);
    });
  }

  return reads;
}

/**
 * A recursive CTE, kept as ONE ordinary section.
 *
 * We are explicitly not visualising recursion, and descending into a body that names itself is how a
 * builder like this hangs. So the section is the CTE read back whole — `with recursive r as (…)
 * select * from r` — which runs, shows the rows, and has nothing left to recurse into.
 */
function addRecursiveCte(
  build: Build,
  args: { cte: Cte; cteText: string; path: string; scope: Scope },
): SectionId | null {
  const { cte, cteText, path, scope } = args;
  const prefix = renderPrefix({ ctes: [...scope.ctes, cteText], recursive: true, known: scope.known });
  const sql = `${prefix}select * from ${cte.name}`;
  const parsed = parseStatement(sql, build.dialect);
  if (isUnsupported(parsed)) {
    build.skipped.push({ why: "unsupported", label: cte.name, reason: parsed.reason, sql });
    return null;
  }
  const id = `${path}.cte:${cte.name}`;
  build.sections.push({
    id,
    label: claimLabel(build, cte.name),
    origin: { kind: "cte", cte },
    parsed,
    text: sql,
    result: null,
    unsafeToProbe: carriesWrite(sql, build.dialect),
    binding: { kind: "standalone", certain: true },
    reads: [...scope.known.values()].filter((id): id is SectionId => id !== null),
    prefix,
  });
  return id;
}

/**
 * How a subquery predicate runs, or null when it should stay inline with no section at all.
 *
 * A correlated scalar subquery that `countingRewrite` refuses — an aggregate, a GROUP BY, a LIMIT —
 * has nothing a per-row probe could usefully ask: it returns one row whatever the outer row is, and
 * counting its "matches" would be a lie. A section for it could only ever show a query it cannot
 * run, so the predicate is left where it is, recorded as inline rather than dropped.
 */
function predicateBinding(
  build: Build,
  predicate: SubqueryPredicate,
  sql: string,
  path: string,
): Binding | null {
  if (predicate.correlated.length > 0) {
    if (predicate.kind === "scalar" && countingRewrite(predicate) === null) {
      build.skipped.push({
        why: "inline",
        label: predicateLabel(predicate),
        reason: "A correlated scalar subquery that already aggregates has no per-row result to walk.",
        sql: sql.slice(predicate.range.from, predicate.range.to),
      });
      return null;
    }
    return { kind: "bound", outer: path, columns: predicate.correlated };
  }
  return { kind: "standalone", certain: isCertainlyUncorrelated(predicate, sql, build.dialect) };
}

/**
 * Whether the text alone rules out a correlation, given nothing qualified pointed outward.
 *
 * Correlation enters through a FILTER: the WHERE, HAVING, JOIN ON/USING or GROUP BY of the subquery
 * is where an unqualified name that secretly belongs to the outer row changes which rows come back.
 * A subquery with no such clause — `select ID from takes` — has nowhere for one to hide, so it is
 * certain even though `ID` is unqualified.
 *
 * The select list is scanned only for a `scalar` predicate, where the returned VALUE is the whole
 * point and an outward-bound name there would change it. For EXISTS the list is discarded outright,
 * and for IN a list that bound outward would compare the outer row to itself — a query nobody
 * writes. That is a judgement call, and it is the one place this can still say "certain" about
 * something a catalogue would disagree with.
 */
function isCertainlyUncorrelated(
  predicate: SubqueryPredicate,
  sql: string,
  dialect: Dialect,
): boolean {
  const parsed = predicate.parsed;
  // A subquery we could not slice tells us nothing, so it cannot be called certain.
  if (parsed.kind !== "select") return false;
  const ranges: Range[] = [];
  if (parsed.where) ranges.push(parsed.where.body);
  if (parsed.having) ranges.push(parsed.having.body);
  if (parsed.groupBy) ranges.push(parsed.groupBy.body);
  for (const join of parsed.joins) {
    if (join.range.to > join.source.range.to) ranges.push({ from: join.source.range.to, to: join.range.to });
  }
  if (predicate.kind === "scalar") ranges.push(parsed.selectList);
  return !hasBareColumnRef(sql, dialect, ranges);
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
function carriesWrite(sql: string, dialect: Dialect): boolean {
  const shape = statementShape(sql, dialect);
  if (shape.kind === "write") return true;
  return shape.ctes.some((cte) => carriesWrite(sql.slice(cte.body.from, cte.body.to), dialect));
}

/* ---------------------------------------------------------------------------------------------- */

function renderPrefix(scope: Scope): string {
  if (scope.ctes.length === 0) return "";
  return `with ${scope.recursive ? "recursive " : ""}${scope.ctes.join(",\n")}\n`;
}

/**
 * A body plus the CTEs in scope, as one statement.
 *
 * When the body declares a WITH of its own the two lists are MERGED rather than stacked: `with a as
 * (…)` followed by `with z as (…)` is not SQL, and a probe built from it would fail on the second
 * keyword rather than on anything the user wrote.
 */
function compose(body: string, scope: Scope, dialect: Dialect): string {
  const trimmed = body.trim();
  const prefix = renderPrefix(scope);
  if (prefix === "") return trimmed;
  const own = parseStatement(trimmed, dialect);
  const first = isUnsupported(own) ? undefined : own.ctes[0];
  if (!isUnsupported(own) && own.with !== null && first !== undefined) {
    const recursive =
      scope.recursive || /^with\s+recursive\b/i.test(trimmed.slice(own.with.from, own.with.to));
    return `with ${recursive ? "recursive " : ""}${scope.ctes.join(",\n")},\n${trimmed.slice(first.range.from)}`;
  }
  return `${prefix}${trimmed}`;
}

function predicateLabel(predicate: SubqueryPredicate): string {
  const source = predicate.parsed.kind === "select" ? predicate.parsed.first.name : "subquery";
  return predicate.kind === "scalar" ? source : `${predicate.kind} ${source}`;
}

/** The first free spelling of a label, so two `not exists takes` sections stay tellable apart. */
function claimLabel(build: Build, label: string): string {
  const seen = build.labels.get(label) ?? 0;
  build.labels.set(label, seen + 1);
  return seen === 0 ? label : `${label} ${seen + 1}`;
}

function dedupe(ids: readonly SectionId[]): SectionId[] {
  return [...new Set(ids)];
}

/** `r` inside `select n+1 from r`, but not inside `router` or `'r'`. */
function mentionsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.$"\`])${escaped}($|[^\\w$"\`])`, "i").test(text);
}

/**
 * Kahn's algorithm over the `reads` edges, emission order breaking ties so the depth-first shape
 * survives.
 *
 * Construction already produces a valid order, so this is a guard rather than a rearrangement — but
 * it is the guard that keeps a cycle from becoming an infinite loop. On a cycle the remaining
 * sections are emitted in the order they were built and any edge that still points forward is
 * dropped, because `Section.reads` promises every id in it appears earlier.
 */
function orderSections(sections: readonly Section[]): Section[] {
  const inProgram = new Set(sections.map((section) => section.id));
  const emitted = new Set<SectionId>();
  const out: Section[] = [];

  while (out.length < sections.length) {
    let progress = false;
    for (const section of sections) {
      if (emitted.has(section.id)) continue;
      if (!section.reads.every((read) => !inProgram.has(read) || emitted.has(read))) continue;
      out.push(section);
      emitted.add(section.id);
      progress = true;
    }
    if (progress) continue;
    for (const section of sections) {
      if (emitted.has(section.id)) continue;
      out.push(section);
      emitted.add(section.id);
    }
  }

  const position = new Map(out.map((section, index) => [section.id, index]));
  return out.map((section, index) => {
    const kept = section.reads.filter((read) => (position.get(read) ?? -1) < index);
    return kept.length === section.reads.length ? section : { ...section, reads: kept };
  });
}

/* ---------------------------------------------------------------------------------------------- */

type SyntaxNode = ReturnType<typeof PostgreSQL.language.parser.parse>["topNode"];

function parserFor(dialect: Dialect): typeof PostgreSQL.language.parser {
  return dialect === "mysql" ? MySQL.language.parser : PostgreSQL.language.parser;
}

/**
 * Whether any of `ranges` holds a column reference nobody qualified.
 *
 * `CompositeIdentifier` is `s.ID` — already qualified, and wave 1's correlation check has had its
 * say about it. A nested `(select …)` is skipped: it is its own scope and its own section, and what
 * it leaves unqualified is its own problem, not this one's.
 */
function hasBareColumnRef(text: string, dialect: Dialect, ranges: readonly Range[]): boolean {
  if (ranges.length === 0) return false;
  const tree = parserFor(dialect).parse(text);
  return ranges.some((range) => scanBare(nodeContaining(tree.topNode, range), text, range));
}

function scanBare(node: SyntaxNode, text: string, range: Range): boolean {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= range.from || child.from >= range.to) continue;
    if (child.name === "CompositeIdentifier") continue;
    if (child.name === "Identifier" || child.name === "QuotedIdentifier") {
      // `upper(name)` puts the function's own name in an Identifier node; the argument list that
      // follows it with no gap is what tells the two apart.
      const next = child.nextSibling;
      if (next && next.name === "Parens" && next.from === child.to) continue;
      return true;
    }
    if (child.name === "Parens" && isSelectParens(child, text)) continue;
    if (scanBare(child, text, range)) return true;
  }
  return false;
}

function isSelectParens(parens: SyntaxNode, text: string): boolean {
  for (let child = parens.firstChild; child; child = child.nextSibling) {
    if (child.name === "(" || child.name === "LineComment" || child.name === "BlockComment") continue;
    const word = text.slice(child.from, child.to).toLowerCase();
    return child.name === "Keyword" && (word === "select" || word === "with");
  }
  return false;
}

/** The deepest node that still holds the whole range. */
function nodeContaining(root: SyntaxNode, range: Range): SyntaxNode {
  let node = root;
  for (;;) {
    let descended = false;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from <= range.from && child.to >= range.to) {
        node = child;
        descended = true;
        break;
      }
    }
    if (!descended) return node;
  }
}
