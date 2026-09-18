// Splits a SQL script into individual statements without a real parser: we only need to know
// where the "top level" semicolons are, so everything else (strings, identifiers, comments,
// dollar-quoted bodies) is skipped verbatim.
//
// The server splits the same script with apps/server/sqlscript/split.go. Change one, change the
// other: a disagreement means the editor highlights a different range than the server executes.

export type SplitStatement = {
  /** The statement text, whitespace-trimmed. Never empty. */
  sql: string;
  /** Character offset of `sql[0]` inside the original script. */
  offset: number;
};

const isSpace = (ch: string | undefined): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";

/**
 * Skips a quoted run starting at `i` (which must be the opening quote).
 * Doubling the quote escapes it (`'it''s'`, `"a""b"`, `` `a``b` ``). Backslash escapes are honoured
 * for ' and " because MySQL and PostgreSQL's E'...' literals use them; this makes a lone trailing
 * backslash in a standard-conforming PostgreSQL literal (`'\'`) look unterminated, which is a much
 * rarer shape than `'\''`.
 */
function skipQuoted(sql: string, i: number, quote: string, backslashEscapes: boolean): number {
  for (let j = i + 1; j < sql.length; j++) {
    const ch = sql[j];
    if (backslashEscapes && ch === "\\") {
      j++;
      continue;
    }
    if (ch === quote) {
      if (sql[j + 1] === quote) {
        j++;
        continue;
      }
      return j + 1;
    }
  }
  return sql.length;
}

/** `-- comment` up to and including the newline. */
function skipLineComment(sql: string, i: number): number {
  const nl = sql.indexOf("\n", i);
  return nl === -1 ? sql.length : nl + 1;
}

/** `/* ... *\/`, nested as PostgreSQL allows. */
function skipBlockComment(sql: string, i: number): number {
  let depth = 1;
  let j = i + 2;
  while (j < sql.length) {
    if (sql[j] === "/" && sql[j + 1] === "*") {
      depth++;
      j += 2;
    } else if (sql[j] === "*" && sql[j + 1] === "/") {
      depth--;
      j += 2;
      if (depth === 0) return j;
    } else {
      j++;
    }
  }
  return sql.length;
}

const DOLLAR_TAG = /^\$([A-Za-z_-￿][A-Za-z0-9_-￿]*)?\$/;

/**
 * Skips a `$tag$ ... $tag$` body. Returns `i` unchanged when this `$` does not open one
 * (e.g. the `$1` of a placeholder), so the caller can keep scanning normally.
 */
function skipDollarQuoted(sql: string, i: number): number {
  const m = DOLLAR_TAG.exec(sql.slice(i, i + 64));
  if (!m) return i;
  const tag = m[0];
  const end = sql.indexOf(tag, i + tag.length);
  return end === -1 ? sql.length : end + tag.length;
}

/** True when a chunk holds nothing but whitespace and comments. */
function isBlank(chunk: string): boolean {
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i]!;
    if (isSpace(ch)) {
      i++;
    } else if (ch === "-" && chunk[i + 1] === "-") {
      i = skipLineComment(chunk, i);
    } else if (ch === "/" && chunk[i + 1] === "*") {
      i = skipBlockComment(chunk, i);
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Splits `sql` on semicolons that are not inside a string, quoted identifier, backtick, comment or
 * dollar-quoted body. Statements are trimmed, statements that hold only whitespace/comments are
 * dropped, and each result keeps the offset of its first character in the original script.
 */
export function splitStatements(sql: string): SplitStatement[] {
  const out: SplitStatement[] = [];
  let start = 0;
  let i = 0;

  const push = (from: number, to: number): void => {
    const chunk = sql.slice(from, to);
    if (isBlank(chunk)) return;
    let s = 0;
    let e = chunk.length;
    while (s < e && isSpace(chunk[s])) s++;
    while (e > s && isSpace(chunk[e - 1])) e--;
    out.push({ sql: chunk.slice(s, e), offset: from + s });
  };

  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"') {
      i = skipQuoted(sql, i, ch, true);
    } else if (ch === "`") {
      i = skipQuoted(sql, i, ch, false);
    } else if (ch === "-" && sql[i + 1] === "-") {
      i = skipLineComment(sql, i);
    } else if (ch === "/" && sql[i + 1] === "*") {
      i = skipBlockComment(sql, i);
    } else if (ch === "$") {
      const next = skipDollarQuoted(sql, i);
      i = next === i ? i + 1 : next;
    } else if (ch === ";") {
      push(start, i);
      start = i + 1;
      i++;
    } else {
      i++;
    }
  }
  push(start, sql.length);
  return out;
}
