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

import type { Dialect } from "@perch/protocol";
import {
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
  type SubqueryPredicate,
  type Unsupported,
} from "./clauses";
import { gridBuild, gridOf } from "./grid";
import { carriesWrite, predicateBinding, projectionBinding } from "./program-binding";
import { mentionsWord, readRecursion } from "./program-recursion";
import type {
  Binding,
  Program,
  ResultOnlyKind,
  RootMap,
  Section,
  SectionId,
  SectionOrigin,
  SkippedPart,
} from "./program-types";
import { placeBody, placeSpan, withUses } from "./root-map";
import { predicateLabel, projectionLabel } from "./section-labels";

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

/**
 * One statement, read into a program of sections.
 *
 * The three fields below are what the emission mutates as it goes, and they are the reason this is
 * a class rather than eleven functions passing a record between them. `sections` is append-only and
 * its ORDER is load-bearing — children are pushed before their parents, which is what makes
 * `Program.sections` topologically sorted by construction.
 */
class ProgramBuilder {
  private readonly sections: Section[] = [];
  private readonly skipped: SkippedPart[] = [];
  /** Label → how many sections have claimed it, so the strip never shows the same name twice. */
  private readonly labels = new Map<string, number>();

  constructor(
    /** The statement as it was handed in: the text every `RootMap` is an offset into, and the text
     *  a mapping is checked against before it is believed. */
    private readonly root: string,
    private readonly dialect: Dialect,
  ) {}

  /**
   * The whole program, or the one refusal that leaves nothing to show.
   *
   * A bare `select 1`, a `VALUES` list and a CTE that writes all have SOME table behind them and
   * get a chapter. A write with no RETURNING hands back nothing, and the walk will not run it to
   * find out.
   */
  build(): Program | Unsupported {
    const shape = statementShape(this.root, this.dialect);
    if (shape.kind === "write" && !shape.returning) {
      return {
        kind: "unsupported",
        reason: `${(shape.verb ?? "This statement").toUpperCase()} changes the database and returns no rows, so there is nothing to walk. Add a RETURNING clause to see what it touched.`,
      };
    }

    const mainId = this.addQuery({
      sql: this.root,
      prefix: "",
      path: "main",
      label: "Result",
      origin: { kind: "main" },
      binding: { kind: "standalone", certain: true },
      scope: EMPTY_SCOPE,
      host: null,
      // The root section's text IS the root text — nothing is spliced on and `parseStatement` does
      // not trim — so its mapping is the identity and every section below it is placed relative to
      // this.
      map: { prefixLength: 0, bodyRoot: 0 },
      // Refined to the parse's `statement` range, which drops a trailing semicolon; this stands only
      // when there is no parse to ask, as for a `values` list that runs as one station.
      source: { from: 0, to: this.root.length },
    });
    // The main query was refused outright. Its own reason is the useful one — "This SELECT has no
    // columns" tells the reader where to look, where a generic line sends them nowhere.
    if (mainId === null) {
      const refusal = this.skipped.find((part) => part.why === "unsupported");
      return { kind: "unsupported", reason: refusal?.reason ?? "This query could not be read." };
    }

    const sections = orderSections(this.sections);
    const main = sections.find((section) => section.id === mainId);
    const parsed = main?.parsed ?? null;
    const program: Program = {
      text: this.root,
      dialect: this.dialect,
      sections,
      mainId,
      setOp: parsed !== null && isSetOp(parsed) ? parsed : null,
      skipped: this.skipped,
    };
    return { ...program, sections: withUses(program) };
  }

  /**
   * Emits one section and, before it, every section it depends on.
   *
   * Children are added first and the section itself last, which is what makes `Program.sections`
   * topologically sorted by construction: a CTE is emitted before the query that selects from it, and
   * a nested EXISTS before the EXISTS that wraps it.
   */
  private addQuery(args: AddArgs): SectionId | null {
    const { sql, prefix, path, origin, binding, scope } = args;
    const parsed = parseStatement(sql, this.dialect);
    if (isUnsupported(parsed)) return this.addResultOnly(args, parsed);

    const reads: SectionId[] = [];
    const absorbed: string[] = [];
    if (isSetOp(parsed)) {
      // The CTEs belong to the WHOLE set operation, not to a branch. Wave 1 seeds every branch parse
      // with them so `from monthly` resolves inside it, which meant each branch reached its own CTE
      // loop with an empty scope and built the CTE all over again — the `a 2` in the chapter strip.
      // Building them HERE, once, and handing the branches a scope that already knows them is what
      // makes every branch read the same section instead of a copy of it.
      const seeded = this.addCtes({
        ctes: parsed.ctes,
        withRange: parsed.with,
        sql,
        path,
        binding,
        scope,
        map: args.map,
      });
      reads.push(
        ...seeded.reads,
        ...this.addBranches(parsed, sql, path, binding, seeded.scope, args.map),
      );
    } else {
      const own = this.addChildren({
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
    this.sections.push({
      id,
      label: this.claimLabel(args.label),
      origin,
      parsed,
      text: sql,
      result: null,
      unsafeToProbe: carriesWrite(sql, this.dialect),
      binding,
      reads: dedupe(reads),
      prefix,
      absorbed,
      // `main` is the whole statement, and only the parse can delimit it: `statement` is the range
      // with a trailing semicolon left off.
      source:
        origin.kind === "main" ? placeSpan(this.root, args.map, sql, parsed.statement) : args.source,
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
  private addResultOnly(args: AddArgs, refusal: Unsupported): SectionId | null {
    const { sql, prefix, path, origin, binding, scope } = args;
    const shape = statementShape(sql, this.dialect);
    const kind: ResultOnlyKind | null =
      shape.kind === "write"
        ? "writes"
        : shape.kind === "values"
          ? "values"
          : shape.kind === "select" && !shape.from
            ? "no-from"
            : null;
    if (kind === null) {
      this.skipped.push({ why: "unsupported", label: args.label, reason: refusal.reason, sql });
      return null;
    }

    // The CTEs first, exactly as a walkable section would. They are ordinary queries with ordinary
    // walks; only the body that reads them is the odd one, and it must not take them down with it.
    const seeded = this.addCtes({
      ctes: shape.ctes,
      withRange: shape.with,
      sql,
      path,
      binding,
      scope,
      map: args.map,
    });
    this.sections.push({
      id: path,
      label: this.claimLabel(args.label),
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
      unsafeToProbe: carriesWrite(sql, this.dialect),
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

  /**
   * The CTEs a statement declares, each its own section, and the scope that results.
   *
   * `ctes` opens with the ones an enclosing prefix spliced into `sql`, which already have sections of
   * their own; `scope.known` is what tells those apart from the ones this statement declares, and
   * skipping them is what stops a CTE in scope from being rebuilt once per statement that can see it.
   */
  private addCtes(args: CteArgs): { scope: Scope; reads: SectionId[] } {
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
      const source = placeSpan(this.root, map, sql, cte.range);
      let id: SectionId | null;
      if (mentionsWord(body, cte.name)) {
        id = this.addRecursiveCte({ cte, cteText, path, scope: inner, source, host: sql, map });
      } else {
        const composed = compose(body, inner, this.dialect);
        const prefix = renderPrefix(inner);
        id = this.addQuery({
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
          map: placeBody(this.root, map, sql, cte.body, composed, prefix),
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
  private addBranches(
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
      const id = this.addQuery({
        sql: composed,
        prefix: withText,
        path: `${path}.branch:${index}`,
        label: `Branch ${index + 1}`,
        origin: { kind: "branch", index, branch },
        // A branch of a per-row section is itself per-row; nothing about the split changes that.
        binding,
        scope,
        host: null,
        map: placeBody(this.root, map, sql, branch.range, composed, withText),
        source: placeSpan(this.root, map, sql, branch.range),
      });
      if (id !== null) out.push(id);
    });
    return out;
  }

  /** The CTEs, derived tables and subquery predicates one SELECT owns, in dependency order. */
  private addChildren(args: ChildArgs): { reads: SectionId[]; absorbed: string[] } {
    const { parsed, sql, path, binding, scope, host } = args;
    const seeded = this.addCtes({
      ctes: parsed.ctes,
      withRange: parsed.with,
      sql,
      path,
      binding,
      scope,
      map: args.map,
    });
    const inner = seeded.scope;
    // Every child built below is composed against the same scope, so it carries the same prefix — and
    // the prefix's length is half of each child's mapping.
    const innerPrefix = renderPrefix(inner);
    const reads: SectionId[] = [...seeded.reads];
    const absorbed: string[] = [];

    // The grid this section's own predicate would become, when it is a per-row section and the SQL
    // allows one. Computed once here, from the same text and the same function the view will use, so
    // "no chapter" and "there is a grid" can never disagree — the one way this could go wrong is a
    // predicate losing its chapter to a grid that then refuses to this.
    const gridOutcome =
      host !== null && binding.kind === "bound"
        ? gridBuild({
            outer: host.parsed,
            middle: parsed,
            predicate: host.predicate,
            correlated: binding.columns,
            dialect: this.dialect,
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
      const composed = compose(sql.slice(source.body.from, source.body.to), inner, this.dialect);
      const id = this.addQuery({
        sql: composed,
        prefix: innerPrefix,
        path: `${path}.from:${index}`,
        label: source.alias ?? source.name,
        origin: { kind: "derived", source },
        binding: binding.kind === "bound" ? binding : own,
        scope: inner,
        host: null,
        map: placeBody(this.root, args.map, sql, source.body, composed, innerPrefix),
        // The derived table as written, parentheses and alias included: `(select …) d`.
        source: placeSpan(this.root, args.map, sql, source.range),
      });
      if (id !== null) reads.push(id);
    });

    /* WHERE and HAVING: every depth-zero subquery predicate. Deeper ones surface when the section
       built here recurses into its own clauses. */
    for (const clause of [parsed.where, parsed.having]) {
      if (clause === null) continue;
      const slot = clause === parsed.where ? "where" : "having";
      subqueryPredicates(sql, clause.body, this.dialect).forEach((predicate, index) => {
        // The grid swallowed this one: it becomes a cell of the section above rather than a chapter
        // that could only hold a note. Its own children still get chapters — a CTE inside it is a real
        // table computed once — and anything correlated among them binds to THIS section, whose grid
        // is where its rows would come from.
        if (grid !== null && sameRange(grid.inner.range, predicate.range)) {
          absorbed.push(predicateLabel(predicate, sql));
          const body = compose(
            sql.slice(predicate.body.from, predicate.body.to),
            inner,
            this.dialect,
          );
          const parsedBody = parseStatement(body, this.dialect);
          if (!isUnsupported(parsedBody) && !isSetOp(parsedBody)) {
            const own = this.addChildren({
              parsed: parsedBody,
              sql: body,
              path: `${path}.cell:${index}`,
              binding,
              scope: inner,
              host: null,
              prefix: innerPrefix,
              boundTo: path,
              map: placeBody(this.root, args.map, sql, predicate.body, body, innerPrefix),
            });
            reads.push(...own.reads);
            absorbed.push(...own.absorbed);
          }
          return;
        }
        const own = predicateBinding(this.skipped, this.dialect, predicate, sql, args.boundTo ?? path);
        if (own === null) return;
        const composed = compose(
          sql.slice(predicate.body.from, predicate.body.to),
          inner,
          this.dialect,
        );
        const id = this.addQuery({
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
          map: placeBody(this.root, args.map, sql, predicate.body, composed, innerPrefix),
          // The predicate as written — `not exists (select …)` — and not just the subquery inside it,
          // because the words that make it a predicate are the ones the reader is looking for.
          source: placeSpan(this.root, args.map, sql, predicate.range),
        });
        if (id !== null) reads.push(id);
      });
    }

    /* SELECT: a subquery in the select list. It is a value and not a filter, which changes nothing
       about why it needs a chapter — the reader has a number on screen and, without one, nothing
       anywhere says where it came from. */
    selectSubqueries(sql, parsed.selectList, this.dialect).forEach((subquery, index) => {
      const own = projectionBinding(subquery, sql, args.boundTo ?? path, this.dialect);
      const composed = compose(sql.slice(subquery.body.from, subquery.body.to), inner, this.dialect);
      const id = this.addQuery({
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
        map: placeBody(this.root, args.map, sql, subquery.body, composed, innerPrefix),
        // The subquery as written and nothing more. A predicate's `source` reaches wider on purpose —
        // `not exists` is part of the thing the reader is looking for — but the `case` or the alias
        // around a select-list subquery is the COLUMN, not the subquery, and lighting it up would
        // claim this chapter computes more than it does.
        source: placeSpan(this.root, args.map, sql, subquery.range),
      });
      if (id !== null) reads.push(id);
    });

    return { reads, absorbed };
  }

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
  private addRecursiveCte(
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
    const prefix = renderPrefix({
      ctes: [...scope.ctes, cteText],
      recursive: true,
      known: scope.known,
    });
    const sql = `${prefix}select * from ${cte.name}`;
    const parsed = parseStatement(sql, this.dialect);
    if (isUnsupported(parsed)) {
      this.skipped.push({ why: "unsupported", label: cte.name, reason: parsed.reason, sql });
      return null;
    }
    const id = `${path}.cte:${cte.name}`;
    this.sections.push({
      id,
      label: this.claimLabel(cte.name),
      origin: { kind: "cte", cte },
      parsed,
      text: sql,
      result: null,
      unsafeToProbe: carriesWrite(sql, this.dialect),
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
      recursion: readRecursion(this.root, this.dialect, cte, args.host, args.map),
    });
    return id;
  }

  /** The first free spelling of a label, so two `not exists takes` sections stay tellable apart. */
  private claimLabel(label: string): string {
    const seen = this.labels.get(label) ?? 0;
    this.labels.set(label, seen + 1);
    return seen === 0 ? label : `${label} ${seen + 1}`;
  }
}

export function buildProgram(text: string, dialect: Dialect): Program | Unsupported {
  return new ProgramBuilder(text, dialect).build();
}

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

const sameRange = (a: Range, b: Range): boolean => a.from === b.from && a.to === b.to;

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

function dedupe(ids: readonly SectionId[]): SectionId[] {
  return [...new Set(ids)];
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
