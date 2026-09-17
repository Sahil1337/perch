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
//
// That synthesis is also why every section has to carry a way BACK. What a section runs is not what
// the reader wrote — it has a WITH prefix the walk invented on the front and a body trimmed at both
// ends — so a chapter shown as "your query" is a statement nobody typed, and nothing built from a
// section's own ranges can be pointed at the query on screen. `source`, `rootMap` and `uses` are the
// return path, and they are cheap because the body IS a verbatim slice of `Program.text`: one
// subtraction maps any offset in it back, and mapping a child's body through its parent's mapping at
// build time makes it compose to any depth.
//
// Where the body is NOT a verbatim slice the mapping is null rather than approximate — see
// `Section.rootMap`. A highlight in the wrong place reads as a fact about the query and is believed;
// a missing one reads as a missing feature. The UI's fallback for a null is to show the statement
// with nothing lit up.

import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import type { Dialect } from "@perch/protocol";
import {
  bareName,
  countingRewrite,
  isSetOp,
  isUnsupported,
  parseStatement,
  selectSubqueries,
  statementShape,
  subqueryPredicates,
  type Cte,
  type ParsedSelect,
  type ParsedSetOp,
  type Range,
  type SelectSubquery,
  type SetBranch,
  type SourceRef,
  type SubqueryPredicate,
  type Unsupported,
} from "./clauses";
import { gridBuild, gridOf } from "./grid";

export type SectionId = string;

export type SectionOrigin =
  | { readonly kind: "cte"; readonly cte: Cte }
  | { readonly kind: "derived"; readonly source: SourceRef }
  | { readonly kind: "predicate"; readonly predicate: SubqueryPredicate }
  /** A subquery in the SELECT list: a column's VALUE rather than a test a row has to pass. */
  | { readonly kind: "projection"; readonly subquery: SelectSubquery }
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

/** One `chain c` inside the recursive term: the thing the database replaces with the previous
 *  pass's rows, and the thing the REPEAT probe replaces with the anchor. */
export type SelfRef = {
  /** Where it sits in `Recursion.stepSql`, source as written and alias included. Never null: the
   *  probe splices by this range, and a probe that could not be built is not a probe. */
  readonly range: Range;
  /** The alias the reader gave it, or the CTE's own name when they gave none — a derived table
   *  spliced in its place must answer to whatever the rest of the term calls it. */
  readonly alias: string;
  /** The same reference in `Program.text`, or null when the mapping refused it. */
  readonly root: Range | null;
};

/**
 * A recursive CTE split into the two queries the database actually runs.
 *
 * Only ever set when the split is CERTAIN. The alternative to falling back is not a slightly wrong
 * picture: a recursive query assembled wrong does not fail politely, it hangs or floods — so the
 * anchor has to be an anchor (a query that can run before anything has been collected) and the step
 * has to name the CTE in source position only, where a derived table can stand in its place. Every
 * shape that does not read that way stays the black box it was, which teaches less and lies none.
 *
 * `anchorSql` and `stepSql` are verbatim slices of the CTE's body with NO WITH prefix of their own:
 * the prefix is rendered once at the head of each probe, and `anchorSql` is spliced into the middle
 * of `stepSql` where a second copy of it would not be legal.
 */
export type Recursion = {
  /** The CTE's name, as the reader spelled it. */
  readonly name: string;
  /** The half that does not mention the CTE — where the recursion begins. */
  readonly anchorSql: string;
  /** The half that does. Its self-references are still in it; splicing them is the probe's job. */
  readonly stepSql: string;
  /** `UNION ALL`, `union`, as written, for a sentence that quotes the reader rather than the parser. */
  readonly operator: string;
  /** A plain UNION: each pass's rows are deduplicated against everything already collected, so a
   *  count of one pass's output is an upper bound on what that pass adds. False for UNION ALL. */
  readonly dedupes: boolean;
  /** Where the anchor term sits in `Program.text`; null when the mapping could not be verified. */
  readonly anchor: Range | null;
  /** Likewise for the recursive term. */
  readonly step: Range | null;
  readonly selfRefs: readonly SelfRef[];
  /** The three stations' sentences, written here because this is the only place that holds both
   *  halves' parses and can therefore name the tables each half really reads. */
  readonly sentences: RecursionSentences;
};

export type RecursionSentences = {
  readonly start: string;
  readonly repeat: string;
  readonly settle: string;
};

/**
 * Where a section's text sits in the text the reader wrote.
 *
 * A section's text is `prefix + body`: the WITH the walk spliced on, then a verbatim slice of
 * `Program.text` — trimmed at both ends, but not otherwise touched. So the whole mapping is two
 * numbers, and `toRootOffset` is a subtraction. Kept as data rather than a closure because a
 * `Program` is handed around, compared and memoised, and a function on it would be none of those.
 */
export type RootMap = {
  /**
   * How many characters at the head of `Section.text` the walk INVENTED. An offset below it is in
   * the spliced prefix — text the reader never wrote — and maps to nothing.
   */
  readonly prefixLength: number;
  /** Where `Section.text.slice(prefixLength)` begins in `Program.text`. */
  readonly bodyRoot: number;
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
  /**
   * The complete statement this section runs, WITH prefix and all. Always present.
   *
   * This is what a probe sends, not what the reader wrote: quoting it as "your query" shows a
   * statement nobody typed. To point at the reader's own text instead, use `source` for the chapter
   * as a whole and `toRootOffset` / `toRootRange` for anything inside it.
   */
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
  /**
   * Predicates this section SWALLOWED, by label, rather than giving each a chapter of its own.
   *
   * A doubly-correlated predicate has no table of outer rows to scrub — its outer rows do not exist
   * until a row of ITS outer section is picked — so a chapter for it could only ever hold a note.
   * When a grid can be built it becomes the cells of this section's grid instead, which is a better
   * picture and a real one. Empty for every other section; non-empty is what the chapter strip reads
   * to say where that piece of SQL went.
   */
  readonly absorbed: readonly string[];
  /**
   * This section's own span in `Program.text`: a CTE's `name AS (…)`, a derived table as written, a
   * predicate as written, a branch, or — for `main` — the whole statement.
   *
   * Null when the span could not be established, which is the same condition as a null `rootMap`
   * plus one more: an origin range that did not survive the check against the root text. A reader
   * shown nothing learns nothing; a reader shown the wrong lines learns something false.
   */
  readonly source: Range | null;
  /**
   * How an offset in `text` becomes an offset in `Program.text`. Read it through `toRootOffset`.
   *
   * Null when this section's text is not a verbatim slice of the root, which happens in exactly two
   * places. `addRecursiveCte` INVENTS a body — `select * from chain` is the walk's sentence, not the
   * reader's — and `compose` rewrites a body that declares a WITH of its own, because merging its
   * list into the prefix is the only way the two can be one statement. Both are real SQL that was
   * never typed, so no offset in them is an offset in the query on screen.
   *
   * A recursive CTE therefore has a `source` and no `rootMap`: the walk knows where the chapter was
   * declared, and nothing about where anything inside its text came from.
   */
  readonly rootMap: RootMap | null;
  /**
   * For a `cte` section: where in `Program.text` this CTE is READ by name — the `chain` in `from
   * chain` or `join chain c`, narrowed to the name and never including the alias.
   *
   * It is the one kind of section whose `source` is nowhere near the line that needs it: a CTE is
   * declared at the top and read fifty lines down, so "where does this chapter belong in my query"
   * is answered by the uses and not by the declaration. Empty for every other kind of section, and
   * empty too of the self-reference inside a recursive CTE, whose body is deliberately never walked.
   */
  readonly uses: readonly Range[];
  /**
   * A recursive CTE the walk could split into its two halves; null when it stayed a black box.
   *
   * Set only on a `cte` section built by `addRecursiveCte`, and only when every test in
   * `readRecursion` passed. Its presence is what swaps the ordinary ten-station walk over the
   * invented `select * from chain` — which narrates a trivial SELECT and never mentions the
   * recursion — for the three stations that do.
   */
  readonly recursion: Recursion | null;
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
  /** The statement as it was handed in: the text every `RootMap` is an offset into, and the text a
   *  mapping is checked against before it is believed. */
  readonly root: string;
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

  const build: Build = { root: text, dialect, sections: [], skipped: [], labels: new Map() };
  const mainId = addQuery(build, {
    sql: text,
    prefix: "",
    path: "main",
    label: "Result",
    origin: { kind: "main" },
    binding: { kind: "standalone", certain: true },
    scope: EMPTY_SCOPE,
    host: null,
    // The root section's text IS the root text — nothing is spliced on and `parseStatement` does not
    // trim — so its mapping is the identity and every section below it is placed relative to this.
    map: { prefixLength: 0, bodyRoot: 0 },
    // Refined to the parse's `statement` range, which drops a trailing semicolon; this stands only
    // when there is no parse to ask, as for a `values` list that runs as one station.
    source: { from: 0, to: text.length },
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
  const program: Program = {
    text,
    dialect,
    sections,
    mainId,
    setOp: parsed !== null && isSetOp(parsed) ? parsed : null,
    skipped: build.skipped,
  };
  return { ...program, sections: withUses(program) };
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
 * An offset in `section.text` as an offset in `program.text`, or null when this section's text is
 * not a verbatim slice of it.
 *
 * Null for two different reasons, and a caller can treat them the same way. The section may have no
 * mapping at all — see `Section.rootMap` — or the offset may fall inside the WITH prefix the walk
 * spliced on, which is the walk's own text and has nowhere honest to land in the reader's. Either
 * way there is no root offset, and the UI shows the statement with nothing lit rather than guessing.
 */
export function toRootOffset(section: Section, offset: number): number | null {
  return rootOffset(section.rootMap, section.text.length, offset);
}

/** A range in `section.text` as a range in `program.text`; null unless BOTH ends map. */
export function toRootRange(section: Section, range: Range): Range | null {
  const from = toRootOffset(section, range.from);
  const to = toRootOffset(section, range.to);
  if (from === null || to === null || to < from) return null;
  return { from, to };
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

/**
 * The select-list subqueries this section projects, each already a section of its own, in the order
 * they are written.
 *
 * `reads` is the right place to look rather than the id: a section reads exactly the children built
 * for it, so this can never pick up a subquery projected by some unrelated part of the query that
 * happens to sit at the same depth.
 */
export function projectionsIn(program: Program, section: Section): Section[] {
  return section.reads
    .map((id) => sectionById(program, id))
    .filter((read): read is Section => read !== null && read.origin.kind === "projection");
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
  /**
   * The query this section is a subquery predicate OF, when it is one.
   *
   * Only a per-row section needs it, and only to ask whether its own inner predicate can become a
   * grid — a question that cannot be answered from the subquery alone, because the probe that fills
   * the grid is built by splicing the OUTER query's FROM and WHERE. Null everywhere else.
   */
  readonly host: GridHost | null;
  /**
   * How offsets in `sql` map back to the root text, worked out by the caller: it is the caller that
   * holds the parent's own mapping and knows which slice of the parent became this body.
   */
  readonly map: RootMap | null;
  /** The section's span in the root text, likewise. `main` refines this from its own parse. */
  readonly source: Range | null;
};

/** The outer query a predicate section hangs off, and the predicate as it sits in it. */
type GridHost = { readonly parsed: ParsedSelect; readonly predicate: SubqueryPredicate };

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
  const absorbed: string[] = [];
  if (isSetOp(parsed)) {
    // The CTEs belong to the WHOLE set operation, not to a branch. Wave 1 seeds every branch parse
    // with them so `from monthly` resolves inside it, which meant each branch reached its own CTE
    // loop with an empty scope and built the CTE all over again — the `a 2` in the chapter strip.
    // Building them HERE, once, and handing the branches a scope that already knows them is what
    // makes every branch read the same section instead of a copy of it.
    const seeded = addCtes(build, { ctes: parsed.ctes, withRange: parsed.with, sql, path, binding, scope, map: args.map });
    reads.push(...seeded.reads, ...addBranches(build, parsed, sql, path, binding, seeded.scope, args.map));
  } else {
    const own = addChildren(build, {
      parsed,
      sql,
      path,
      binding,
      scope,
      host: args.host,
      prefix,
      boundTo: null,
      map: args.map,
    });
    reads.push(...own.reads);
    absorbed.push(...own.absorbed);
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
    absorbed,
    // `main` is the whole statement, and only the parse can delimit it: `statement` is the range
    // with a trailing semicolon left off.
    source: origin.kind === "main" ? placeSpan(build, args.map, sql, parsed.statement) : args.source,
    rootMap: args.map,
    uses: [],
    recursion: null,
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
  const seeded = addCtes(build, { ctes: shape.ctes, withRange: shape.with, sql, path, binding, scope, map: args.map });
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
    absorbed: [],
    source: args.source,
    rootMap: args.map,
    uses: [],
    recursion: null,
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
  /** The mapping of `sql`, which is what places each CTE body in the root text. */
  readonly map: RootMap | null;
};

/**
 * The CTEs a statement declares, each its own section, and the scope that results.
 *
 * `ctes` opens with the ones an enclosing prefix spliced into `sql`, which already have sections of
 * their own; `scope.known` is what tells those apart from the ones this statement declares, and
 * skipping them is what stops a CTE in scope from being rebuilt once per statement that can see it.
 */
function addCtes(build: Build, args: CteArgs): { scope: Scope; reads: SectionId[] } {
  const { ctes, withRange, sql, path, binding, scope, map } = args;
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
    // The chapter's own span is the declaration, `name AS (…)`, whichever way the body is walked.
    const source = placeSpan(build, map, sql, cte.range);
    let id: SectionId | null;
    if (mentionsWord(body, cte.name)) {
      id = addRecursiveCte(build, { cte, cteText, path, scope: inner, source, host: sql, map });
    } else {
      const composed = compose(body, inner, build.dialect);
      const prefix = renderPrefix(inner);
      id = addQuery(build, {
        sql: composed,
        prefix,
        path: `${path}.cte:${cte.name}`,
        label: cte.name,
        origin: { kind: "cte", cte },
        // A CTE sits at the top of the statement, where there is no outer row to depend on, so
        // it always computes exactly once.
        binding: binding.kind === "bound" ? binding : { kind: "standalone", certain: true },
        scope: inner,
        host: null,
        map: placeBody(build, map, sql, cte.body, composed, prefix),
        source,
      });
    }
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
  map: RootMap | null,
): SectionId[] {
  const withText = parsed.with ? `${sql.slice(parsed.with.from, parsed.with.to)}\n` : "";
  const out: SectionId[] = [];
  parsed.branches.forEach((branch, index) => {
    const body = sql.slice(branch.range.from, branch.range.to).trim();
    const composed = `${withText}${body}`;
    const id = addQuery(build, {
      sql: composed,
      prefix: withText,
      path: `${path}.branch:${index}`,
      label: `Branch ${index + 1}`,
      origin: { kind: "branch", index, branch },
      // A branch of a per-row section is itself per-row; nothing about the split changes that.
      binding,
      scope,
      host: null,
      map: placeBody(build, map, sql, branch.range, composed, withText),
      source: placeSpan(build, map, sql, branch.range),
    });
    if (id !== null) out.push(id);
  });
  return out;
}

type ChildArgs = {
  readonly parsed: ParsedSelect;
  readonly sql: string;
  readonly path: string;
  readonly binding: Binding;
  readonly scope: Scope;
  readonly host: GridHost | null;
  readonly prefix: string;
  /**
   * The section a correlated child must bind to, when this query is not itself a section.
   *
   * It is set for exactly one caller: the children of a predicate the grid absorbed. That predicate
   * has no id of its own, so a child that says "I run per row of my parent" has to name the section
   * whose grid its parent became — otherwise it would point at a path nothing emitted, and the view
   * would report the section as missing from the walk rather than as three levels deep.
   */
  readonly boundTo: SectionId | null;
  /** The mapping of `sql`: every child placed here is placed through it. */
  readonly map: RootMap | null;
};

/** The CTEs, derived tables and subquery predicates one SELECT owns, in dependency order. */
function addChildren(
  build: Build,
  args: ChildArgs,
): { reads: SectionId[]; absorbed: string[] } {
  const { parsed, sql, path, binding, scope, host } = args;
  const seeded = addCtes(build, { ctes: parsed.ctes, withRange: parsed.with, sql, path, binding, scope, map: args.map });
  const inner = seeded.scope;
  // Every child built below is composed against the same scope, so it carries the same prefix — and
  // the prefix's length is half of each child's mapping.
  const innerPrefix = renderPrefix(inner);
  const reads: SectionId[] = [...seeded.reads];
  const absorbed: string[] = [];

  // The grid this section's own predicate would become, when it is a per-row section and the SQL
  // allows one. Computed once here, from the same text and the same function the view will use, so
  // "no chapter" and "there is a grid" can never disagree — the one way this could go wrong is a
  // predicate losing its chapter to a grid that then refuses to build.
  const gridOutcome =
    host !== null && binding.kind === "bound"
      ? gridBuild({
          outer: host.parsed,
          middle: parsed,
          predicate: host.predicate,
          correlated: binding.columns,
          dialect: build.dialect,
          prefix: args.prefix,
        })
      : null;
  const grid = gridOutcome === null ? null : gridOf(gridOutcome);

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
    const composed = compose(sql.slice(source.body.from, source.body.to), inner, build.dialect);
    const id = addQuery(build, {
      sql: composed,
      prefix: innerPrefix,
      path: `${path}.from:${index}`,
      label: source.alias ?? source.name,
      origin: { kind: "derived", source },
      binding: binding.kind === "bound" ? binding : own,
      scope: inner,
      host: null,
      map: placeBody(build, args.map, sql, source.body, composed, innerPrefix),
      // The derived table as written, parentheses and alias included: `(select …) d`.
      source: placeSpan(build, args.map, sql, source.range),
    });
    if (id !== null) reads.push(id);
  });

  /* WHERE and HAVING: every depth-zero subquery predicate. Deeper ones surface when the section
     built here recurses into its own clauses. */
  for (const clause of [parsed.where, parsed.having]) {
    if (clause === null) continue;
    const slot = clause === parsed.where ? "where" : "having";
    subqueryPredicates(sql, clause.body, build.dialect).forEach((predicate, index) => {
      // The grid swallowed this one: it becomes a cell of the section above rather than a chapter
      // that could only hold a note. Its own children still get chapters — a CTE inside it is a real
      // table computed once — and anything correlated among them binds to THIS section, whose grid
      // is where its rows would come from.
      if (grid !== null && sameRange(grid.inner.range, predicate.range)) {
        absorbed.push(predicateLabel(predicate, sql));
        const body = compose(sql.slice(predicate.body.from, predicate.body.to), inner, build.dialect);
        const parsedBody = parseStatement(body, build.dialect);
        if (!isUnsupported(parsedBody) && !isSetOp(parsedBody)) {
          const own = addChildren(build, {
            parsed: parsedBody,
            sql: body,
            path: `${path}.cell:${index}`,
            binding,
            scope: inner,
            host: null,
            prefix: innerPrefix,
            boundTo: path,
            map: placeBody(build, args.map, sql, predicate.body, body, innerPrefix),
          });
          reads.push(...own.reads);
          absorbed.push(...own.absorbed);
        }
        return;
      }
      const own = predicateBinding(build, predicate, sql, args.boundTo ?? path);
      if (own === null) return;
      const composed = compose(sql.slice(predicate.body.from, predicate.body.to), inner, build.dialect);
      const id = addQuery(build, {
        sql: composed,
        prefix: innerPrefix,
        path: `${path}.${slot}:${index}`,
        label: predicateLabel(predicate, sql),
        origin: { kind: "predicate", predicate },
        // A subquery nested inside a per-row section is itself per-row, even when nothing in its
        // own text is correlated: it cannot run until the row above it exists.
        binding: own.kind === "bound" || binding.kind !== "bound" ? own : binding,
        scope: inner,
        // A grid is offered only to a section that can actually be bound, which means the query
        // around it must run exactly once. A predicate inside a per-row section is `held` — it
        // shows a note and never renders — so absorbing ITS inner predicate would trade a chapter
        // for a grid nobody will see.
        host: binding.kind === "standalone" ? { parsed, predicate } : null,
        map: placeBody(build, args.map, sql, predicate.body, composed, innerPrefix),
        // The predicate as written — `not exists (select …)` — and not just the subquery inside it,
        // because the words that make it a predicate are the ones the reader is looking for.
        source: placeSpan(build, args.map, sql, predicate.range),
      });
      if (id !== null) reads.push(id);
    });
  }

  /* SELECT: a subquery in the select list. It is a value and not a filter, which changes nothing
     about why it needs a chapter — the reader has a number on screen and, without one, nothing
     anywhere says where it came from. */
  selectSubqueries(sql, parsed.selectList, build.dialect).forEach((subquery, index) => {
    const own = projectionBinding(subquery, sql, args.boundTo ?? path, build.dialect);
    const composed = compose(sql.slice(subquery.body.from, subquery.body.to), inner, build.dialect);
    const id = addQuery(build, {
      sql: composed,
      prefix: innerPrefix,
      path: `${path}.select:${index}`,
      label: projectionLabel(subquery, sql),
      origin: { kind: "projection", subquery },
      // Per-row by inheritance, the same rule the predicates above follow: a subquery projected out
      // of a section that itself runs per row cannot run until the row above it exists.
      binding: own.kind === "bound" || binding.kind !== "bound" ? own : binding,
      scope: inner,
      // A grid is a picture of a predicate's verdicts, and this has none.
      host: null,
      map: placeBody(build, args.map, sql, subquery.body, composed, innerPrefix),
      // The subquery as written and nothing more. A predicate's `source` reaches wider on purpose —
      // `not exists` is part of the thing the reader is looking for — but the `case` or the alias
      // around a select-list subquery is the COLUMN, not the subquery, and lighting it up would
      // claim this chapter computes more than it does.
      source: placeSpan(build, args.map, sql, subquery.range),
    });
    if (id !== null) reads.push(id);
  });

  return { reads, absorbed };
}

const sameRange = (a: Range, b: Range): boolean => a.from === b.from && a.to === b.to;

/**
 * A recursive CTE, kept as ONE section — with three stations instead of ten when its shape can be
 * read, and the old black box when it cannot.
 *
 * Descending into a body that names itself is how a builder like this hangs, so the section's TEXT
 * is still the CTE read back whole — `with recursive r as (…) select * from r` — which runs, shows
 * the rows, and has nothing left to recurse into. What `readRecursion` adds is not a descent: it
 * splits the body in two and hands the halves to `steps.ts`, which probes each of them as a query
 * of its own. The walk still never iterates, and still never runs anything the database would not.
 */
function addRecursiveCte(
  build: Build,
  args: {
    cte: Cte;
    cteText: string;
    path: string;
    scope: Scope;
    source: Range | null;
    /** The statement the CTE was declared in: what `cte.body` indexes. */
    host: string;
    /** That statement's own mapping, which is what places the two halves in the root text. */
    map: RootMap | null;
  },
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
    absorbed: [],
    // The declaration is real and worth pointing at; the body is not. `select * from chain` is a
    // sentence this function wrote, so there is no offset in this section's text that is an offset
    // in the reader's — mapping it to the CTE's body would light up SQL that says something else.
    source: args.source,
    rootMap: null,
    uses: [],
    // The halves, by contrast, ARE the reader's own text, and they are placed against the root the
    // same way everything else is — so the stations built from them can point at real lines even
    // though the statement they hang off is invented.
    recursion: readRecursion(build, cte, args.host, args.map),
  });
  return id;
}

/**
 * The two halves of a recursive CTE, or null when the shape is anything but the one we can read.
 *
 * EVERY test below is a refusal, and each one protects the same thing. The probes built from this
 * run on the reader's database: a "step" that is not really a step, or an "anchor" that turns out
 * to need the CTE, is not a mislabelled card — it is a statement that recurses without a base case
 * or joins a table to itself with nothing to stop it, and a query like that does not fail politely.
 * It hangs, or it returns rows until something runs out. So the bar is proof, not likelihood:
 *
 *  - Two branches and one operator, and that operator UNION or UNION ALL. INTERSECT and EXCEPT are
 *    not how a recursive CTE is written, and a third branch means one of the two roles is shared by
 *    branches we would then have to decide between.
 *  - Both branches plain SELECTs. A nested set operation inside a branch has its own two halves,
 *    and which of them carries the self-reference is a question this function does not ask.
 *  - Branch 0 silent about the CTE and branch 1 loud about it. Written the other way round — which
 *    some dialects accept — the two roles are swapped, and a "START" that names the CTE would be a
 *    query that cannot run at all.
 *  - Every BARE mention of the name in branch 1 in a SOURCE position. This is the one that matters
 *    most: a self-reference in a WHERE subquery, or in a scalar in the select list, is not something
 *    a derived table can be spliced in place of, and splicing the anchor into the FROM while LEAVING
 *    that mention behind would build a statement that still names an undefined table. The test is
 *    the splice itself — blank every source we found and ask what of the name survives — because
 *    that asks about the text we are about to rewrite rather than about our model of it. What may
 *    survive is a QUALIFIER, and why that is safe is the subtle part: see `survivesSplice`.
 */
function readRecursion(
  build: Build,
  cte: Cte,
  host: string,
  map: RootMap | null,
): Recursion | null {
  const body = host.slice(cte.body.from, cte.body.to);
  const parsed = parseStatement(body, build.dialect);
  if (isUnsupported(parsed) || !isSetOp(parsed)) return null;
  if (parsed.branches.length !== 2 || parsed.operators.length !== 1) return null;

  const between = parsed.operators[0]!;
  if (between.op !== "union" && between.op !== "union all") return null;
  const [anchorBranch, stepBranch] = parsed.branches;
  if (anchorBranch === undefined || stepBranch === undefined) return null;
  const anchorParsed = anchorBranch.parsed;
  const stepParsed = stepBranch.parsed;
  if (anchorParsed.kind !== "select" || stepParsed.kind !== "select") return null;

  // Branch ranges index `body`, and so do the sources inside `stepParsed`: a set operation's
  // branches are parsed over the whole text rather than over a slice of it.
  const anchorSql = body.slice(anchorBranch.range.from, anchorBranch.range.to);
  const stepSql = body.slice(stepBranch.range.from, stepBranch.range.to);
  if (mentionsWord(anchorSql, cte.name) || !mentionsWord(stepSql, cte.name)) return null;

  const wanted = bareName(cte.name).toLowerCase();
  const selfRefs: SelfRef[] = [];
  for (const source of [stepParsed.first, ...stepParsed.joins.map((join) => join.source)]) {
    // A derived table is a parenthesised query that happens to be called something; it is never the
    // CTE, and `(select … from chain) chain` would put the real self-reference out of reach.
    if (source.kind === "derived") continue;
    if (bareName(source.name).toLowerCase() !== wanted) continue;
    selfRefs.push({
      range: {
        from: source.range.from - stepBranch.range.from,
        to: source.range.to - stepBranch.range.from,
      },
      alias: source.alias ?? cte.name,
      root: placeSpan(build, map, host, {
        from: cte.body.from + source.range.from,
        to: cte.body.from + source.range.to,
      }),
    });
  }
  if (selfRefs.length === 0) return null;
  const blanked = blankOut(stepSql, selfRefs.map((ref) => ref.range));
  if (survivesSplice(blanked, cte.name, selfRefs.map((ref) => ref.alias))) return null;

  const operator = body.slice(between.range.from, between.range.to);
  const place = (range: Range): Range | null =>
    placeSpan(build, map, host, { from: cte.body.from + range.from, to: cte.body.from + range.to });
  return {
    name: cte.name,
    anchorSql,
    stepSql,
    operator,
    dedupes: between.op === "union",
    anchor: place(anchorBranch.range),
    step: place(stepBranch.range),
    selfRefs,
    sentences: recursionSentences(cte.name, operator, between.op === "union", anchorParsed, stepParsed),
  };
}

/** The ranges replaced by spaces of their own length, so offsets stay put and no two words that
 *  were apart are pushed together. Used to ask what a piece of SQL says with something taken out. */
function blankOut(text: string, ranges: readonly Range[]): string {
  let out = text;
  for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, range.from) + " ".repeat(range.to - range.from) + out.slice(range.to);
  }
  return out;
}

/**
 * Whether the CTE's name still says something the splice has not accounted for — the last and
 * strictest test in `readRecursion`, run over the step with every spliced source already blanked.
 *
 * A BARE mention is fatal and a QUALIFIED one is not, and the difference is what the splice leaves
 * behind. `from chain` becomes `from (…) chain`: the derived table keeps the name as its alias,
 * because that is what the rest of the term is already calling it. So `where chain.depth < 5` —
 * the usual way to write a depth guard — still resolves afterwards, against the derived table
 * instead of against the CTE, and nothing about the statement has changed but where those rows come
 * from. A bare `chain` has no such alias to land on: it is a second, un-spliced reference to the
 * recursive CTE, and leaving it in is how the REPEAT probe would name a table that isn't there —
 * or, worse, name the real recursive CTE and run the recursion this walk exists not to run.
 *
 * Three ways that could be got wrong, and how each is closed:
 *
 *  - The qualifier must match the alias the splice will ACTUALLY keep, not the CTE's name. When the
 *    reader wrote `from chain c` the derived table is called `c`, so a surviving `chain.x` resolves
 *    to nothing and this falls back. That is why the aliases are passed in rather than assumed.
 *  - Quoting and case are compared the way SQL compares them — through `bareName`, lower-cased — so
 *    `CHAIN.depth` and a quoted alias answer to each other and a raw string match never decides it.
 *  - A near miss is not a mention. The pattern is the one `mentionsWord` uses, so `chained.x` does
 *    not count as `chain.x`, `e.chain` is a column and not a source, and the scan resumes at the end
 *    of the NAME rather than past the character after it — otherwise `chain chain` would hide its
 *    second half inside the first's trailing character.
 *
 * A schema qualifier reads as a match here and is harmless: a CTE lives in no schema, so `chain.foo`
 * is some other object entirely, the splice leaves it exactly as written, and it goes on meaning
 * what it meant.
 */
function survivesSplice(text: string, name: string, aliases: readonly string[]): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\w.$"\`])(${escaped})($|[^\\w$"\`])`, "gi");
  const kept = new Set(aliases.map((alias) => bareName(alias).toLowerCase()));
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    const end = hit.index + hit[1]!.length + hit[2]!.length;
    if (text[end] !== "." || !kept.has(bareName(hit[2]!).toLowerCase())) return true;
    pattern.lastIndex = end;
  }
  return false;
}

/**
 * What the three stations say, written here because this is the only place holding both halves'
 * parses — and so the only place that can name the tables each half actually reads.
 *
 * The hard part is that these have to be TRUE of what the probes below them show, and the probes
 * show ONE pass. So REPEAT says so in as many words rather than letting a reader who sees a rows
 * card assume it is the finished table, and SETTLE is explicit that the database ran every pass
 * even though the walk ran one. Nothing here promises the walk iterated, because it does not.
 */
function recursionSentences(
  name: string,
  operator: string,
  dedupes: boolean,
  anchor: ParsedSelect,
  step: ParsedSelect,
): RecursionSentences {
  const cte = code(name);
  const op = code(operator);
  const start = `${cte} is two queries joined by ${op}, and this is the half that never mentions ${cte}: it ${reads(anchor, name)}, so it can run before anything at all has been collected. These rows are where the recursion begins — every row ${cte} ends up holding descends from one of them.`;
  const pass = `The other half is the step, and it ${reads(step, name)} — with ${cte} standing for what the pass before it produced. What is below is the FIRST PASS ONLY: ${cte} here is exactly the rows START found, spliced in where the step names it. The walk stops after that one pass; the database does not. Pass 2 runs the same step over pass 1's rows, pass 3 over pass 2's, and so on until a pass adds nothing and the recursion ends.`;
  const repeat = dedupes
    ? `${pass} And because the halves are joined by ${op} rather than ${code("union all")}, every pass's rows are matched against everything collected so far and the duplicates dropped — so the count below is an upper bound on what this pass really adds, not the number itself.`
    : pass;
  const settle = `These are the rows left when that repetition stops: ${cte} in full, as the database built it — every pass it ran, however many that was, collected into one table. START's rows are the first of them and REPEAT's are one pass's worth; this is all of them, and this is what the rest of the query reads under the name ${cte}.`;
  return { start, repeat, settle };
}

/** `reads `emp`` / `reads `emp` and `dept``: the tables a term is over, the CTE's own name left out
 *  because a sentence that said a query "reads chain" while explaining chain would explain nothing. */
function reads(parsed: ParsedSelect, name: string): string {
  const own = bareName(name).toLowerCase();
  const tables: string[] = [];
  for (const source of [parsed.first, ...parsed.joins.map((join) => join.source)]) {
    if (bareName(source.name).toLowerCase() === own) continue;
    if (!tables.includes(source.name)) tables.push(source.name);
  }
  if (tables.length === 0) return "reads no table of its own";
  const quoted = tables.map(code);
  return `reads ${quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`}`;
}

/** The narrator's own quoting convention, which these sentences are read alongside. */
const code = (text: string): string => `\`${text.replace(/\s+/g, " ").trim()}\``;

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
        label: predicateLabel(predicate, sql),
        reason: "A correlated scalar subquery that already aggregates has no per-row result to walk.",
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
      build.dialect,
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
function projectionBinding(
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
 * What a select-list subquery is CALLED on the chapter strip.
 *
 * The alias, when the reader wrote one: it is already their name for this number, and it is what
 * they will look for when they see it in the result. With none, naming it after the table it reads
 * would repeat the bug `predicateLabel` describes — two `count(*)`s over one table would come out
 * with the same name and be told apart by a numeral — so the fallback is the subquery as written,
 * which is the reader's own spelling and cannot be mistaken for a table's name.
 */
function projectionLabel(subquery: SelectSubquery, sql: string): string {
  return subquery.alias ?? clip(sql.slice(subquery.range.from, subquery.range.to));
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
    if (join.range.to > join.source.range.to) ranges.push({ from: join.source.range.to, to: join.range.to });
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
function resolvesLocally(
  bare: readonly string[],
  parsed: ParsedSelect,
  dialect: Dialect,
): boolean {
  if (parsed.joins.length > 0) return false;
  if (parsed.first.kind !== "cte" || parsed.first.body === null) return false;
  // The CTE's body is a range into the same text, because the parse was seeded with the CTEs the
  // enclosing WITH put in scope; re-parsing it is how its select list becomes a list of names.
  const body = parseStatement(parsed.text.slice(parsed.first.body.from, parsed.first.body.to), dialect);
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
function carriesWrite(sql: string, dialect: Dialect): boolean {
  const shape = statementShape(sql, dialect);
  if (shape.kind === "write") return true;
  return shape.ctes.some((cte) => carriesWrite(sql.slice(cte.body.from, cte.body.to), dialect));
}

/* ---------------------------------------------------------------------------------------------- */

/** `toRootOffset` without a section: the same subtraction, for a mapping still being built. */
function rootOffset(map: RootMap | null, length: number, offset: number): number | null {
  if (map === null) return null;
  if (offset < map.prefixLength || offset > length) return null;
  return map.bodyRoot + (offset - map.prefixLength);
}

/**
 * Where a child's composed text sits in the root, or null when that cannot be said.
 *
 * The child is `prefix + parentText.slice(body).trim()`, so its body begins where the parent's does
 * once leading whitespace is skipped, and the parent's own mapping carries that offset the rest of
 * the way down. Nesting therefore costs nothing: by the time a child is built its parent is placed.
 *
 * The comparison at the end is not doubt about the arithmetic. `compose` MERGES a body that declares
 * a WITH of its own into the prefix, which moves and rewrites the very text being placed, and from
 * here that is invisible — the composed string looks like any other. Either the root really does
 * spell what this section runs or the mapping is a lie, so it is checked and dropped rather than
 * shipped. The cost is one string compare per section.
 */
function placeBody(
  build: Build,
  parent: RootMap | null,
  parentText: string,
  body: Range,
  text: string,
  prefix: string,
): RootMap | null {
  const written = parentText.slice(body.from, body.to);
  const lead = written.length - written.trimStart().length;
  const bodyRoot = rootOffset(parent, parentText.length, body.from + lead);
  if (bodyRoot === null) return null;
  const slice = text.slice(prefix.length);
  if (build.root.slice(bodyRoot, bodyRoot + slice.length) !== slice) return null;
  return { prefixLength: prefix.length, bodyRoot };
}

/** A span of the parent's text as a span of the root's, checked the same way and for the same
 *  reason: a `source` nobody verified would light up whatever happens to be at that offset. */
function placeSpan(
  build: Build,
  parent: RootMap | null,
  parentText: string,
  span: Range,
): Range | null {
  const from = rootOffset(parent, parentText.length, span.from);
  const to = rootOffset(parent, parentText.length, span.to);
  if (from === null || to === null || to < from) return null;
  return build.root.slice(from, to) === parentText.slice(span.from, span.to) ? { from, to } : null;
}

/**
 * Where each CTE section is READ, filled in once every section exists.
 *
 * It is a pass and not part of construction because a use is a fact about some other section: `from
 * chain` is written in the query that reads it, and that query is built after the CTE it reads.
 * Resolution goes through `sectionForSource`, so a name is credited to the section that this
 * particular query actually reads under it — a CTE shadowed by a nearer one of the same name never
 * collects the other's uses.
 *
 * A reference inside a spliced prefix maps to null and drops out on its own, which is what keeps the
 * copy of `with chain as (…)` that every descendant carries from being reported as a use.
 *
 * The `program` handed in is complete but for the field being computed, which nothing here reads.
 */
function withUses(program: Program): Section[] {
  const found = new Map<SectionId, Range[]>();
  for (const section of program.sections) {
    const parsed = section.parsed;
    // A set operation's sources belong to its branches, and every branch is a section of its own.
    if (parsed === null || isSetOp(parsed)) continue;
    for (const source of [parsed.first, ...parsed.joins.map((join) => join.source)]) {
      if (source.kind !== "cte") continue;
      const read = sectionForSource(program, section, source);
      if (read === null || read.origin.kind !== "cte") continue;
      const range = toRootRange(section, nameRange(section.text, source));
      if (range === null) continue;
      // The slice has to BE the name. Narrowing past an alias is string work on text this function
      // did not parse, and a range that lit up the wrong word would be believed.
      const written = bareName(program.text.slice(range.from, range.to)).toLowerCase();
      if (written !== bareName(read.origin.cte.name).toLowerCase()) continue;
      const seen = found.get(read.id) ?? [];
      if (!seen.some((other) => sameRange(other, range))) seen.push(range);
      found.set(read.id, seen);
    }
  }
  return program.sections.map((section) => {
    const uses = found.get(section.id);
    return uses === undefined ? section : { ...section, uses };
  });
}

/**
 * `chain c` narrowed to `chain`.
 *
 * A `SourceRef` range covers the source as written, alias and all, and highlighting the alias would
 * claim the name is longer than it is. The name is the first token — a CTE reference cannot be
 * schema-qualified, since a CTE lives in no schema — and its quotes are part of it, so a quoted name
 * with a space in it is matched whole rather than cut at the space.
 */
function nameRange(text: string, source: SourceRef): Range {
  const head = NAME_HEAD.exec(text.slice(source.range.from, source.range.to));
  const length = head === null ? source.range.to - source.range.from : head[0].length;
  return { from: source.range.from, to: source.range.from + length };
}

const NAME_HEAD = /^(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|[^\s,()]+)/;

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
function predicateLabel(predicate: SubqueryPredicate, sql: string): string {
  const source = predicate.parsed.kind === "select" ? predicate.parsed.first.name : "subquery";
  if (predicate.kind !== "scalar") return `${predicate.kind} ${source}`;
  const { left, operator } = predicate;
  // Written the other way round — `(select …) > 5` — the compared expression sits on the RIGHT of
  // the operator, and a label that swapped the sides would be quoting something nobody typed.
  if (left === null || operator === null) return source;
  const text = clip(sql.slice(left.from, left.to));
  return left.from > predicate.body.to ? `(…) ${operator} ${text}` : `${text} ${operator} (…)`;
}

/** Long enough for a comparison anyone writes, short enough that the strip truncates a run-on
 *  expression rather than a name that was nearly readable. */
const LABEL_CHARS = 28;

function clip(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= LABEL_CHARS ? one : `${one.slice(0, LABEL_CHARS - 1)}…`;
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
  "and", "or", "not", "is", "isnull", "notnull", "in", "between", "like", "ilike", "similar", "to",
  "escape", "exists", "any", "all", "some", "unique", "overlaps", "symmetric", "asymmetric",
  "null", "true", "false", "unknown", "default",
  "case", "when", "then", "else", "end",
  "select", "from", "where", "group", "having", "order", "by", "limit", "offset", "fetch", "with",
  "as", "on", "using", "join", "inner", "left", "right", "full", "cross", "natural", "lateral",
  "union", "intersect", "except", "distinct", "asc", "desc", "nulls", "collate",
  "over", "partition", "window", "filter", "within", "rows", "range", "groups", "preceding",
  "following", "unbounded", "current", "row", "exclude", "ties", "others", "only",
  "cast", "interval", "at", "zone", "local", "localtime", "localtimestamp", "current_date",
  "current_time", "current_timestamp", "current_user", "session_user", "user",
  "array", "boolean", "bool", "int", "integer", "smallint", "bigint", "decimal", "numeric", "real",
  "double", "precision", "float", "char", "character", "varchar", "varying", "text", "bytea",
  "json", "jsonb", "uuid", "money", "date", "time", "timestamp", "timestamptz",
  "extract", "substring", "trim", "position", "overlay", "leading", "trailing", "both", "for",
]);

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
