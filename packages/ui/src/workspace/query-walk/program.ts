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

// The builder moved into a family of modules; this is the path they are read through.
//
// - `program-types.ts`      what a section IS
// - `program-build.ts`      `ProgramBuilder`, which emits them
// - `program-binding.ts`    whether a subquery depends on the outer row
// - `program-recursion.ts`  reading a recursive CTE into two halves
// - `root-map.ts`           the way back to the text the reader wrote
// - `program-select.ts`     reading a finished program
// - `section-labels.ts`     what a section is called on the strip

export { buildProgram } from "./program-build";
export { isUnsupportedProgram, projectionsIn, sectionById, sectionForSource } from "./program-select";
export type {
  Binding,
  Program,
  Recursion,
  RecursionSentences,
  ResultOnly,
  Section,
  SectionId,
  SkippedPart,
} from "./program-types";
export { toRootRange } from "./root-map";
