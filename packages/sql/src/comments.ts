// Lifting the comments out of a statement, so the query walk can read them back as the author's
// prose beside the SQL instead of leaving them as noise inside it. A `-- why this join exists`
// belongs in the narration; it does not belong in the text of the query the walk echoes.
//
// This is frontend-only, so unlike split.ts there is no server copy for
// `bun run --filter @perch/sql check` to hold it to. split.ts is the one mirrored file and must
// stay byte-identical to `apps/server/src/core/sql/split.ts`, which is why the quote, comment and
// dollar-quote skipping below is duplicated here rather than imported from it: sharing a helper
// would mean editing split.ts, and that file is not this package's to edit.
//
// Two traps live in here, and both look skippable:
//
//   - A `--` or `/*` inside a string literal, a quoted or backtick identifier, or a `$tag$ … $tag$`
//     body is ordinary text. `select '-- not a comment'` has no comment in it at all. That is why
//     this walks the statement the way split.ts does instead of reaching for a regex, and why the
//     skipping has to be faithful down to the doubled quotes and the backslash escapes.
//   - Removing a comment must not weld its neighbours into one token. `a/*x*/b` is two names and
//     has to come back as `a b`; delete the comment and you have silently rewritten the query.

export type SqlComment = {
  /** The comment's text, with `--` or the `/* … *\/` delimiters removed and the ends trimmed. */
  readonly text: string;
  readonly kind: "line" | "block";
  /** Range in the ORIGINAL text: `sql.slice(from, to)` is the comment, delimiters included. */
  readonly from: number;
  readonly to: number;
  /** 1-based line of `from` in the original text, for the reader to find it again. */
  readonly line: number;
  /** Offset in the STRIPPED text where the comment used to sit, so a caller can ask which clause
   *  it annotated. */
  readonly anchor: number;
};

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

/**
 * End of a `-- comment`, *excluding* the newline — where split.ts includes it.
 *
 * The newline is not the comment's to give away: it is the line break the author wrote between two
 * clauses, and swallowing it would put `from t` on the end of `select 1`.
 */
function lineCommentEnd(sql: string, i: number): number {
  const nl = sql.indexOf("\n", i);
  return nl === -1 ? sql.length : nl;
}

/** End of a `/* ... *\/`, nested as PostgreSQL allows. */
function blockCommentEnd(sql: string, i: number): number {
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

const DOLLAR_TAG = /^\$([A-Za-z_-￿][A-Za-z0-9_-￿]*)?\$/;

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

/** A comment as found, before anything is known about where it lands once the text is stripped. */
type Found = {
  readonly kind: "line" | "block";
  readonly from: number;
  readonly to: number;
  readonly line: number;
};

/** Every comment in source order, skipping the literals that only look like they hold one. */
function findComments(sql: string): Found[] {
  const out: Found[] = [];
  let i = 0;
  let line = 1;

  // Line counting rides along with the walk rather than being recomputed per comment: the
  // characters inside a skipped literal or block comment still carry newlines that count.
  const advance = (to: number): void => {
    for (let j = i; j < to; j++) if (sql[j] === "\n") line++;
    i = to;
  };

  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"') {
      advance(skipQuoted(sql, i, ch, true));
    } else if (ch === "`") {
      advance(skipQuoted(sql, i, ch, false));
    } else if (ch === "-" && sql[i + 1] === "-") {
      const to = lineCommentEnd(sql, i);
      out.push({ kind: "line", from: i, to, line });
      advance(to);
    } else if (ch === "/" && sql[i + 1] === "*") {
      const to = blockCommentEnd(sql, i);
      out.push({ kind: "block", from: i, to, line });
      advance(to);
    } else if (ch === "$") {
      const next = skipDollarQuoted(sql, i);
      advance(next === i ? i + 1 : next);
    } else {
      advance(i + 1);
    }
  }
  return out;
}

/** The comment's own words. An unterminated block comment has no `*\/` to drop, so it keeps
 *  everything to the end of the text. */
function textOf(sql: string, found: Found): string {
  if (found.kind === "line") return sql.slice(found.from + 2, found.to).trim();
  const closed = found.to - found.from >= 4 && sql.startsWith("*/", found.to - 2);
  return sql.slice(found.from + 2, closed ? found.to - 2 : found.to).trim();
}

function trimEnd(s: string): string {
  let e = s.length;
  while (e > 0 && /\s/.test(s[e - 1]!)) e--;
  return s.slice(0, e);
}

const EMPTY: readonly SqlComment[] = [];

/**
 * Removes every comment from `sql` and reports what was removed.
 *
 * The stripped text is meant to be handed to a parser or shown as "the query", so it is kept
 * readable rather than merely comment-free:
 *
 *   - A block comment becomes one space, because the two halves it separated may be two tokens.
 *   - A line comment goes, but its newline stays.
 *   - A line left holding nothing but whitespace goes entirely, newline included — otherwise a
 *     five-line `--` prompt leaves five blank lines above the query. A line that still holds SQL
 *     keeps its newline and loses its trailing whitespace.
 *
 * Only lines a comment was removed from are touched, so a script with no comments comes back
 * character-for-character as it went in, blank lines and all.
 */
export function stripComments(sql: string): {
  readonly sql: string;
  readonly comments: readonly SqlComment[];
} {
  const found = findComments(sql);
  if (found.length === 0) return { sql, comments: EMPTY };

  // Pass one: cut the comments out, remembering where each one sat in the text being built.
  let cut = "";
  const marks: number[] = [];
  let cursor = 0;
  for (const c of found) {
    cut += sql.slice(cursor, c.from);
    marks.push(cut.length);
    if (c.kind === "block") cut += " ";
    cursor = c.to;
  }
  cut += sql.slice(cursor);

  // Pass two: settle the lines the cuts left behind, carrying each mark to where it now points.
  const anchors: number[] = [];
  let out = "";
  let mark = 0;
  let start = 0;
  for (;;) {
    const nl = cut.indexOf("\n", start);
    const end = nl === -1 ? cut.length : nl;
    const content = cut.slice(start, end);

    let next = mark;
    while (next < marks.length && marks[next]! <= end) next++;
    const touched = next > mark;
    const drop = touched && content.trim() === "";
    const kept = drop ? "" : touched ? trimEnd(content) : content;

    for (; mark < next; mark++) {
      // A dropped line has no offset of its own left, so its comments anchor at the first
      // character that survived it — `out.length` is exactly where the next kept line starts.
      anchors.push(drop ? out.length : out.length + Math.min(marks[mark]! - start, kept.length));
    }

    if (!drop) out += kept + (nl === -1 ? "" : "\n");
    if (nl === -1) break;
    start = nl + 1;
  }

  const comments = found.map((c, index) => ({
    text: textOf(sql, c),
    kind: c.kind,
    from: c.from,
    to: c.to,
    line: c.line,
    anchor: Math.max(0, Math.min(anchors[index] ?? out.length, out.length)),
  }));
  return { sql: out, comments };
}

/**
 * Every comment in `sql`, in source order, each carrying where it came from and where it would
 * land once stripped.
 *
 * Consecutive `--` lines stay separate entries: whether three of them are one paragraph or three
 * remarks is the caller's judgement, and merging here would throw away the line numbers it needs
 * to make it.
 */
export function scanComments(sql: string): SqlComment[] {
  return [...stripComments(sql).comments];
}
