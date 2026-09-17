// The CASE expressions in a select list, in the shape the SELECT station's sentence needs.

import type { ParsedSelect } from "./clauses";
import { at, pieces, textOf, until } from "./item-pieces";

type CaseBranch = { readonly when: string; readonly then: string };

type CaseExpr = {
  /** `case … end`, as written. */
  readonly expr: string;
  readonly branches: readonly CaseBranch[];
  /** The ELSE result as written; null when there is none, and an unmatched row comes out null. */
  readonly fallback: string | null;
};

const ENDS_RESULT = new Set(["when", "else", "end", "case"]);

/**
 * Every `CASE WHEN … THEN … END` in the select list, branch by branch.
 *
 * Only the searched form is read. The simple form (`case salary when 90000 then …`) compares each
 * WHEN against an operand, and the walk would have to write that comparison itself to test a
 * branch on its own — which is the one thing this module does not do. A CASE nested inside another
 * at the same depth is given up on for the same reason: half a reading is worse than none.
 */
export function caseExpressions(parsed: ParsedSelect): CaseExpr[] {
  const out: CaseExpr[] = [];
  for (const item of parsed.selectItems) {
    const list = pieces(item);
    const start = list.findIndex((piece) => piece.word === "case");
    if (start < 0 || at(list, start + 1) !== "when") continue;
    const branches: CaseBranch[] = [];
    let fallback: string | null = null;
    let end = -1;
    let i = start + 1;
    while (i < list.length) {
      const word = at(list, i);
      if (word === "when") {
        const then = until(list, i + 1, new Set(["then", "case", "end"]));
        if (at(list, then) !== "then") break;
        const next = until(list, then + 1, ENDS_RESULT);
        if (next >= list.length) break;
        branches.push({
          when: textOf(item, list.slice(i + 1, then)),
          then: textOf(item, list.slice(then + 1, next)),
        });
        i = next;
      } else if (word === "else") {
        const close = until(list, i + 1, new Set(["end", "case"]));
        if (at(list, close) !== "end") break;
        fallback = textOf(item, list.slice(i + 1, close));
        i = close;
      } else if (word === "end") {
        end = list[i]!.to;
        break;
      } else break;
    }
    if (end < 0 || branches.length === 0) continue;
    out.push({ expr: item.slice(list[start]!.from, end), branches, fallback });
  }
  return out;
}
