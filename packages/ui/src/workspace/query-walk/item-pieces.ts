// Splitting one select item into its words, without a parser.
//
// The clause slicer works on the statement's depth-zero tokens, which is the right grain for
// finding a WHERE and the wrong one for reading `rank() over (partition by dept order by salary)`
// out of the middle of a select list. This walks the characters instead, skipping over quoted
// strings, comments and balanced groups, so a `(` inside a literal never opens anything.

/** A bare word, a parenthesised group, a literal or an operator, with its offsets into the item. */
export type Piece = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** Lower-cased text when the piece is an unqualified bare word, else null. */
  readonly word: string | null;
};

export const WORD_CHAR = /[A-Za-z0-9_$.]/;

export const BARE_WORD = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** Past the literal or quoted name opening at `start`; a doubled quote continues it rather than
 *  ending it, which is how `'it''s'` stays one literal. */
export function endOfQuoted(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] !== quote) i++;
    else if (text[i + 1] === quote) i += 2;
    else return i + 1;
  }
  return text.length;
}

export function endOfComment(text: string, start: number): number {
  if (text[start + 1] === "-") {
    const newline = text.indexOf("\n", start);
    return newline < 0 ? text.length : newline + 1;
  }
  const close = text.indexOf("*/", start + 2);
  return close < 0 ? text.length : close + 2;
}

export const opensComment = (text: string, i: number): boolean =>
  (text[i] === "-" && text[i + 1] === "-") || (text[i] === "/" && text[i + 1] === "*");

/** Past the group opening at `start`. Literals and comments inside it are skipped, so a `)` typed
 *  inside a string never closes the group early. */
export function endOfGroup(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"' || ch === "`") i = endOfQuoted(text, i);
    else if (opensComment(text, i)) i = endOfComment(text, i);
    else {
      if (ch === "(") depth += 1;
      else if (ch === ")" && (depth -= 1) === 0) return i + 1;
      i += 1;
    }
  }
  return text.length;
}

export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (opensComment(text, i)) {
      i = endOfComment(text, i);
      continue;
    }
    const from = i;
    if (ch === "(") i = endOfGroup(text, i);
    else if (ch === "'" || ch === '"' || ch === "`") i = endOfQuoted(text, i);
    else if (WORD_CHAR.test(ch)) while (i < text.length && WORD_CHAR.test(text[i]!)) i += 1;
    else i += 1;
    const slice = text.slice(from, i);
    out.push({
      from,
      to: i,
      text: slice,
      word: BARE_WORD.test(slice) ? slice.toLowerCase() : null,
    });
  }
  return out;
}

export const textOf = (source: string, list: readonly Piece[]): string =>
  list.length === 0 ? "" : source.slice(list[0]!.from, list[list.length - 1]!.to);

/** Splits a run of pieces on its depth-zero commas: a comma inside a group is inside one piece. */
export function splitCommas(source: string, list: readonly Piece[]): string[] {
  const out: string[] = [];
  let current: Piece[] = [];
  for (const piece of list) {
    if (piece.text === ",") {
      if (current.length > 0) out.push(textOf(source, current));
      current = [];
    } else current.push(piece);
  }
  if (current.length > 0) out.push(textOf(source, current));
  return out;
}

export const at = (list: readonly Piece[], index: number): string | null => list[index]?.word ?? null;

/** Past `start`, the first piece whose word is one of `stop`; `list.length` when none is. */
export function until(list: readonly Piece[], start: number, stop: ReadonlySet<string>): number {
  let i = start;
  while (i < list.length && !(list[i]!.word !== null && stop.has(list[i]!.word!))) i += 1;
  return i;
}
