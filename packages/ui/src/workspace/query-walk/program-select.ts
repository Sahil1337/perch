// Reading a finished program: finding a section by id, by the source that names it, or by what it
// is a projection of.

import { type SourceRef, type Unsupported } from "./clauses";
import type { Program, Section, SectionId } from "./program-types";

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
