// What the chapter strip says about a section: what it is in the query the user wrote, what its
// status means, and the caveat a section whose independence could not be proved has to carry.

import type { SubqueryPredicateKind } from "../clauses";
import type { SectionRun } from "../use-walk";

/**
 * `not exists` → `a NOT EXISTS`, `in` → `an IN`, `scalar` → `a scalar`.
 *
 * The article is chosen from the phrase as it will be read, not from the kind: `exists` takes "an"
 * but the `not exists` that contains it takes "a", so a fixed article is wrong for four of the five
 * kinds. The SQL keywords are upper-cased because that is what they are; `scalar` is our word for
 * the shape rather than anything the user typed, so it stays prose.
 */
function predicatePhrase(kind: SubqueryPredicateKind): string {
  const name = kind === "scalar" ? "scalar" : kind.toUpperCase();
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/** What a status means to someone reading the strip, for the accessible name and the tooltip. */
export function note(run: SectionRun): string {
  switch (run.status) {
    case "pending":
      return "waiting";
    case "running":
      return "running";
    case "done":
      return "done";
    case "per-row":
      return "runs once per row of the section above it";
    case "held":
      return "runs per row, and needs its parent's row bound first";
    case "unwalkable":
      return "combines the branches";
    case "writes":
      return run.section.result?.kind === "writes"
        ? "changes the database, so it is shown but not run"
        : "reads a step that changes the database, so it was not run either";
  }
}

/**
 * What the open section IS, in the query the user wrote.
 *
 * The station rail below says FROM, JOIN, WHERE — but a CTE's FROM and the final query's FROM look
 * identical on it, and the SQL in the narrator is the section's own text with its WITH prefix
 * already spliced away. So without this line there is nothing on screen that answers "am I looking
 * at the CTE or at the query that reads it", which is the first thing anyone asks.
 */
export function describe(run: SectionRun, sections: readonly SectionRun[]): string {
  const { origin, binding } = run.section;
  const outer =
    binding.kind === "bound"
      ? (sections.find((entry) => entry.section.id === binding.outer)?.section.label ??
        "the query above it")
      : null;
  // What it IS comes before where it sits: a CTE that is a VALUES list or a DELETE is a CTE either
  // way, but "computed once before anything that reads it" is not the sentence a reader needs when
  // the chapter in front of them has one card instead of a rail.
  const result = run.section.result;
  if (result !== null) {
    switch (result.kind) {
      case "values":
        return "a table written out in the query itself, so there are no clauses to step through.";
      case "no-from":
        return "a SELECT with no FROM: it computes its expressions once, over no rows at all.";
      case "writes":
        return "changes the database, so the walk shows it and never runs it.";
    }
  }
  if (run.section.unsafeToProbe) {
    return "reads a WITH step that changes the database, so the walk did not run it either.";
  }
  switch (origin.kind) {
    case "cte":
      return "declared by WITH, and computed once before anything that reads it.";
    case "derived":
      return "a subquery in FROM, computed before the query around it.";
    case "predicate": {
      // Where the third piece of SQL went. A predicate this section swallowed has no chapter of its
      // own, and a reader who can see it in the query and not on the strip is owed the sentence that
      // says it did not vanish — it is the cells.
      const swallowed = run.section.absorbed;
      const cells =
        swallowed.length === 0
          ? ""
          : ` Its own ${swallowed.join(" and ")} runs once per cell of the grid.`;
      return outer
        ? `${predicatePhrase(origin.predicate.kind)} subquery, re-run for every row of ${outer}.${cells}`
        : `${predicatePhrase(origin.predicate.kind)} subquery. Nothing in it depends on the outer row, so it is computed once.${cells}`;
    }
    case "projection":
      // Correlation decides the whole sentence, because it decides what the reader is looking at: one
      // number repeated down the column, or a different number on every row.
      return outer
        ? `a subquery in the SELECT list, so it is a column of ${outer} rather than a filter on it — and it runs once for every row of ${outer}, landing a different value on each.`
        : "a subquery in the SELECT list. Nothing in it depends on the outer row, so it is computed once, before the rows are projected, and the same value lands on every one of them.";
    case "branch":
      return `branch ${origin.index + 1} of the set operation.`;
    case "main":
      return "the query's final result.";
  }
}

/** A section the parse could not prove runs exactly once has to say so somewhere. This is it. */
export function caveat(run: SectionRun): string | null {
  const { binding } = run.section;
  return binding.kind === "standalone" && !binding.certain
    ? "reading the SQL could not rule out that this depends on the outer row"
    : null;
}
