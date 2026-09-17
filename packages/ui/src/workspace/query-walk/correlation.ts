// Which references inside a subquery point OUTWARD, and where they are.
//
// This is the property the whole program hangs on: a subquery that names a column of the query
// around it runs once per outer row, and one that does not runs once. Only QUALIFIED references are
// reported, because `course_id` with no table in front of it cannot be resolved without a
// catalogue — see the note at the top of `program.ts` for what is done with that uncertainty.

import type { Dialect } from "@perch/protocol";
import {
  isSelectParens,
  normalizeRef,
  parensTokens,
  parserFor,
  splitRef,
  type SyntaxNode,
} from "./clause-tokens";
import type { Cte, ParsedSelect, Range, Unsupported } from "./clause-types";
import { parseTokens } from "./parse-select";
import { setOpBranchParses } from "./parse-setop";

/** Every qualifier a SELECT puts in scope: each source by its alias if it has one, else its name,
 *  plus the CTEs it can see. */
function definedQualifiers(parsed: ParsedSelect | Unsupported): Set<string> {
  const out = new Set<string>();
  if (parsed.kind !== "select") return out;
  for (const source of [parsed.first, ...parsed.joins.map((join) => join.source)]) {
    out.add((source.alias ?? source.name).toLowerCase());
  }
  for (const cte of parsed.ctes) out.add(cte.name.toLowerCase());
  return out;
}

/**
 * The references inside a subquery that name something it does not define — the outer query's rows.
 *
 * Only QUALIFIED references count. A bare `course_id` could belong to either query and there is no
 * catalogue here to settle it, so guessing would either invent a correlation or hide one; naming
 * only what the SQL itself makes unambiguous is the honest answer.
 *
 * The walk descends through nested subqueries carrying their scopes with it, so `takes.ID` inside a
 * doubly-nested EXISTS is resolved by the FROM that actually declares `takes`, while `student.ID`
 * from the outermost query surfaces as correlated at every level that does not define it.
 */
export function correlatedIn(
  parens: SyntaxNode,
  text: string,
  parsed: ParsedSelect | Unsupported,
  scopeCtes: readonly Cte[],
): string[] {
  const out: string[] = [];
  // A set-operation body is refused by the SELECT slicer, and an `Unsupported` defines no
  // qualifiers and skips no source ranges — so without the branches below, every `t.semester`
  // inside `select t.ID from takes t … intersect …` would look like a reference to the OUTER query
  // and the predicate would be classed as correlated. That is the expensive direction to be wrong
  // in: the subquery would be re-run once per outer row and described as depending on a row it has
  // never heard of.
  const branches = parsed.kind === "select" ? [] : setOpBranchParses(parens, text, scopeCtes);
  const defined =
    parsed.kind === "select"
      ? definedQualifiers(parsed)
      : new Set(branches.flatMap((branch) => [...definedQualifiers(branch)]));
  const skip = parsed.kind === "select" ? skipRanges(parsed) : branches.flatMap(skipRanges);
  collectCorrelated(parens, text, defined, skip, scopeCtes, out);
  return out;
}

/** A plain table source is written `schema.table alias`, whose `schema.table` is a qualified
 *  reference to nothing — skipping the source's own range keeps it out of the correlation list. */
function skipRanges(parsed: ParsedSelect | Unsupported): Range[] {
  if (parsed.kind !== "select") return [];
  return [parsed.first, ...parsed.joins.map((join) => join.source)]
    .filter((source) => source.kind === "table")
    .map((source) => source.range);
}

function collectCorrelated(
  node: SyntaxNode,
  text: string,
  defined: ReadonlySet<string>,
  skip: readonly Range[],
  scopeCtes: readonly Cte[],
  out: string[],
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LineComment" || child.name === "BlockComment" || child.name === "String")
      continue;
    if (skip.some((range) => child!.from >= range.from && child!.to <= range.to)) continue;
    if (child.name === "CompositeIdentifier") {
      const ref = text.slice(child.from, child.to);
      const qualifier = splitRef(ref).qualifier;
      if (qualifier && !defined.has(qualifier.toLowerCase()) && !out.includes(ref)) out.push(ref);
      continue;
    }
    if (child.name === "Parens" && isSelectParens(child, text)) {
      const inner = parseTokens(text, parensTokens(child, text), scopeCtes);
      const scope = new Set([...defined, ...definedQualifiers(inner)]);
      collectCorrelated(child, text, scope, [...skip, ...skipRanges(inner)], scopeCtes, out);
      continue;
    }
    collectCorrelated(child, text, defined, skip, scopeCtes, out);
  }
}

/**
 * Where each of `refs` is written inside `text`, as ranges, so a caller can splice a value over it.
 *
 * Only `CompositeIdentifier` nodes are matched, which is the same node the correlation check
 * reported them from, and the comparison goes through `splitRef` so `"s"."ID"` and `s.id` are
 * recognised as the reference `s.ID` the caller asked for. Riding on the parse rather than on a
 * search is what keeps a reference named inside a string literal or a comment from being rewritten:
 * neither is a `CompositeIdentifier`, so neither is ever returned.
 *
 * Scope is NOT re-checked, and there is one shape where that shows. A reference is only ever asked
 * for because the correlation check said it points outward, and it says that only when no scope in
 * the query defines the qualifier — so every occurrence of it normally means the same row. The
 * exception is a subquery nested inside this one that declares the very same alias: its own `s.ID`
 * is local, and this returns it alongside the outer ones. Re-deriving scope per occurrence would fix
 * it; it is not done here because an alias shadowing the outer query's alias, inside a subquery of a
 * correlated subquery, is a query nobody writes, and the cost of being wrong about it is one
 * substitution in the displayed SQL rather than a wrong answer anywhere else.
 */
export function refRanges(
  text: string,
  dialect: Dialect,
  refs: readonly string[],
): { readonly ref: string; readonly range: Range }[] {
  const wanted = new Map(refs.map((ref) => [normalizeRef(ref), ref]));
  const out: { ref: string; range: Range }[] = [];
  const visit = (node: SyntaxNode): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === "CompositeIdentifier") {
        const ref = wanted.get(normalizeRef(text.slice(child.from, child.to)));
        if (ref !== undefined) out.push({ ref, range: { from: child.from, to: child.to } });
        continue;
      }
      visit(child);
    }
  };
  visit(parserFor(dialect).parse(text).topNode);
  return out;
}
