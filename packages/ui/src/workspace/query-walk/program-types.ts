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

// This file is the vocabulary: what a section IS, and what each field of one is allowed to mean.
// Nothing here parses or emits anything — `program-build.ts` does that — so the documentation of a
// field sits next to the field rather than next to whichever function happened to fill it in.

import type { Dialect } from "@perch/protocol";
import type {
  Cte,
  ParsedSelect,
  ParsedSetOp,
  Range,
  SelectSubquery,
  SetBranch,
  SourceRef,
  SubqueryPredicate,
} from "./clauses";

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
