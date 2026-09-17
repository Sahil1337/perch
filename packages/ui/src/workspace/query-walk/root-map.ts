// The way back from what a section RUNS to what the reader wrote.
//
// A section's text is not the reader's: it has a WITH prefix the walk invented on the front and a
// body trimmed at both ends. So every offset a chapter wants to point at has to be mapped, and a
// mapping that cannot be proved is null rather than approximate — `program.ts`'s header says why.
// A highlight in the wrong place reads as a fact about the query and is believed; a missing one
// reads as a missing feature.

import { bareName, isSetOp, type Range, type SourceRef } from "./clauses";
import { sectionForSource } from "./program-select";
import type { Program, RootMap, Section, SectionId } from "./program-types";

/** Two ranges over the same text. */
const sameRange = (a: Range, b: Range): boolean => a.from === b.from && a.to === b.to;

/**
 * An offset in `section.text` as an offset in `program.text`, or null when this section's text is
 * not a verbatim slice of it.
 *
 * Null for two different reasons, and a caller can treat them the same way. The section may have no
 * mapping at all — see `Section.rootMap` — or the offset may fall inside the WITH prefix the walk
 * spliced on, which is the walk's own text and has nowhere honest to land in the reader's. Either
 * way there is no root offset, and the UI shows the statement with nothing lit rather than guessing.
 */
function toRootOffset(section: Section, offset: number): number | null {
  return rootOffset(section.rootMap, section.text.length, offset);
}

/** A range in `section.text` as a range in `program.text`; null unless BOTH ends map. */
export function toRootRange(section: Section, range: Range): Range | null {
  const from = toRootOffset(section, range.from);
  const to = toRootOffset(section, range.to);
  if (from === null || to === null || to < from) return null;
  return { from, to };
}

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
export function placeBody(
  /** The statement as the reader wrote it, which the placement is CHECKED against. It is required
   *  rather than optional on purpose: a placement nobody verified lights up whatever happens to be
   *  at that offset, and a highlight in the wrong place reads as a fact about the query. */
  root: string,
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
  if (root.slice(bodyRoot, bodyRoot + slice.length) !== slice) return null;
  return { prefixLength: prefix.length, bodyRoot };
}

/** A span of the parent's text as a span of the root's, checked the same way and for the same
 *  reason: a `source` nobody verified would light up whatever happens to be at that offset. */
export function placeSpan(
  /** The reader's own statement, for the same check and the same reason as `placeBody`. */
  root: string,
  parent: RootMap | null,
  parentText: string,
  span: Range,
): Range | null {
  const from = rootOffset(parent, parentText.length, span.from);
  const to = rootOffset(parent, parentText.length, span.to);
  if (from === null || to === null || to < from) return null;
  return root.slice(from, to) === parentText.slice(span.from, span.to) ? { from, to } : null;
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
export function withUses(program: Program): Section[] {
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
