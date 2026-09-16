// Formatting, shared by the editor's Shift-Alt-F keybinding and the command palette's "Format
// document" action.
//
// This is frontend-only: unlike split.ts, apps/server has no need to format SQL, so there is no
// server copy for `bun run --filter @perch/sql check` to keep this in sync with.

import type { Dialect, Settings } from "@perch/protocol";
import { splitStatements } from "./split";

/** A `$tag$ … $tag$` body anywhere in the statement. sql-formatter mangles these; leave them be. */
const DOLLAR_QUOTED = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

export type FormatSqlOptions = {
  dialect: Dialect;
  /** `Settings.keywordCase`. `"preserve"` passes straight through to sql-formatter. */
  keywordCase: Settings["keywordCase"];
};

/**
 * Formats each statement in `sql` independently, via `sql-formatter`.
 *
 * Per statement rather than per document for two reasons: sql-formatter *throws* on anything it
 * cannot parse, and one unparseable statement should not cost you the formatting of the other
 * nine; and re-assembling the text from the original gaps between statements leaves the comments
 * and blank lines between them alone. A statement containing a dollar-quoted body is left as
 * written for the same reason — sql-formatter does not understand PostgreSQL's `$tag$…$tag$`
 * strings and mangles them.
 *
 * `sql-formatter` is lazily imported: it is the largest dependency reachable from the editor and
 * most sessions never format anything.
 */
export async function formatSql(sql: string, options: FormatSqlOptions): Promise<string> {
  const statements = splitStatements(sql);
  if (statements.length === 0) return sql;

  const { format } = await import("sql-formatter");
  const language = options.dialect === "mysql" ? "mysql" : "postgresql";

  let out = "";
  let cursor = 0;
  for (const statement of statements) {
    // Whatever sits between the previous statement and this one — blank lines, comments — is
    // copied verbatim.
    out += sql.slice(cursor, statement.offset);

    let formatted = statement.sql;
    if (!DOLLAR_QUOTED.test(statement.sql)) {
      try {
        formatted = format(statement.sql, {
          keywordCase: options.keywordCase,
          language,
          tabWidth: 2,
        });
      } catch {
        // Unparseable (a dialect extension, or mid-edit). Keep the author's text.
      }
    }
    out += formatted;
    cursor = statement.offset + statement.sql.length;
  }
  out += sql.slice(cursor);

  // `splitStatements` trims each statement, so a trailing newline in the source never survives
  // into `out` on its own; put back exactly one if the original had one.
  if (/\n\s*$/.test(sql) && !out.endsWith("\n")) out += "\n";

  return out;
}
