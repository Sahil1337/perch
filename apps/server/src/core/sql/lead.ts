// Finds the first word that actually starts a statement. Both dialects need it to classify a
// statement from its text — Postgres to decide whether to open a cursor, MySQL to invent the
// command tag it never receives — and both have to look past the same leading noise.
//
// It lives here rather than in split.ts because `packages/sql/scripts/assert-in-sync.mjs` keeps
// that file byte-identical to its frontend copy, and this helper is server-only.

/**
 * Drops leading whitespace, line and block comments, and open parens, returning the rest of the
 * script from the first character that could begin a keyword. Returns "" when the script is
 * nothing but noise (or an unterminated comment).
 */
export function stripLeadingNoise(sql: string): string {
  let i = 0;
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i]!)) i++;
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) return "";
      i = nl + 1;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return "";
      i = end + 2;
      continue;
    }
    if (sql[i] === "(") {
      i++;
      continue;
    }
    return sql.slice(i);
  }
}
