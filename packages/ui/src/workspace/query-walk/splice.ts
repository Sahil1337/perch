// Putting a statement back together: the walk never regenerates SQL, it splices the user's own
// ranges, so what runs is their own spelling of every clause.

import type { Range, SqlPart } from "./clause-types";

/**
 * The prefix every name the walk invents carries, so one can never collide with a name the user
 * wrote. It lives down here, where the query builders and the parser can both reach it; `steps.ts`
 * re-exports this one, because importing it the other way round would invert the layering —
 * `steps.ts` is what imports `clauses.ts`.
 */
export const WALK_PREFIX = "_perch_walk_";

/** Rebuilds `statement` with each edit's range swapped for its replacement, everything between
 *  them kept exactly as the user typed it. An edit that overlaps one already applied is dropped,
 *  which is how a reference sitting inside a replaced select list disappears with it. */
export function spliceRanges(
  text: string,
  statement: Range,
  edits: readonly { range: Range; with: string }[],
): string {
  return spliceParts(text, statement, edits)
    .map((part) => part.text)
    .join("");
}

/** `spliceRanges`, with the substitutions kept apart from the text around them. `over` is set from
 *  an edit's own `over`, so only the edits that claim one are marked as substitutions. */
export function spliceParts(
  text: string,
  statement: Range,
  edits: readonly { range: Range; with: string; over?: string }[],
): SqlPart[] {
  const ordered = [...edits].sort((a, b) => a.range.from - b.range.from);
  const parts: SqlPart[] = [];
  let cursor = statement.from;
  for (const edit of ordered) {
    if (edit.range.from < cursor || edit.range.to > statement.to) continue;
    parts.push({ text: text.slice(cursor, edit.range.from), over: null });
    parts.push({ text: edit.with, over: edit.over ?? null });
    cursor = edit.range.to;
  }
  parts.push({ text: text.slice(cursor, statement.to), over: null });
  // The trim has to survive the split, because `spliceRanges` is these parts joined and callers
  // compare its output against SQL they already have. Trimming the first and last runs in place is
  // NOT the same thing — a run that is entirely whitespace would keep the whitespace in the run
  // before it — so whole runs are dropped from each end until one has something in it. Checked
  // against the previous implementation over 20,000 random splices.
  while (parts.length > 0) {
    const first = parts[0]!;
    const text = first.text.trimStart();
    if (text === "") {
      parts.shift();
      continue;
    }
    parts[0] = { ...first, text };
    break;
  }
  while (parts.length > 0) {
    const last = parts[parts.length - 1]!;
    const text = last.text.trimEnd();
    if (text === "") {
      parts.pop();
      continue;
    }
    parts[parts.length - 1] = { ...last, text };
    break;
  }
  return parts.filter((part) => part.text !== "");
}
