// Formatting, shared by the editor's Shift-Alt-F keybinding and the command palette's "Format
// document" action.
//
// This is frontend-only: unlike split.ts, apps/server has no need to format SQL, so there is no
// server copy for `bun run --filter @perch/sql check` to keep this in sync with.

import type { Dialect, Settings } from "@perch/protocol";
import { splitStatements } from "./split";

export type FormatSqlOptions = {
  dialect: Dialect;
  /** `Settings.keywordCase`. `"preserve"` leaves every keyword as the author typed it. */
  keywordCase: Settings["keywordCase"];
  /** Column the printer wraps at. A clause that fits below this stays on one line. */
  printWidth?: number;
};

const DEFAULT_PRINT_WIDTH = 90;

type Printer = {
  format: (source: string, options: Record<string, unknown>) => Promise<string>;
  plugin: unknown;
};

/**
 * `prettier-plugin-sql-cst` parses SQL into a concrete syntax tree and prints it through
 * Prettier, so the layout follows the text: a clause that fits stays on one line, one that does
 * not breaks. `prettier/standalone` is the browser build — the default entry point reaches for
 * node:fs.
 *
 * Both are lazily imported, and memoised so a second format does not pay the import again. They
 * are the largest thing reachable from the editor and most sessions never format anything.
 */
let printer: Promise<Printer> | undefined;
const loadPrinter = (): Promise<Printer> =>
  (printer ??= (async () => {
    const [prettier, plugin] = await Promise.all([
      import("prettier/standalone"),
      import("prettier-plugin-sql-cst"),
    ]);
    return { format: prettier.format, plugin };
  })());

/**
 * `sql-formatter` only tokenises, so it never fails to produce *something*. That makes it the
 * floor under the parser: a real grammar rejects what it does not know, and the CST plugin's
 * PostgreSQL grammar has holes worth caring about in a SQL client — `EXPLAIN (ANALYZE, …)`,
 * `VACUUM`, `COPY … FROM`. On MySQL it misses `GROUP_CONCAT(… SEPARATOR …)`, index hints and
 * `CAST(x AS UNSIGNED)`. Those statements format the way they did before this plugin existed
 * rather than silently doing nothing.
 *
 * Imported only when a statement actually needs it, so a document of ordinary SQL never loads it.
 */
let fallback: Promise<typeof import("sql-formatter")> | undefined;
const loadFallback = (): Promise<typeof import("sql-formatter")> =>
  (fallback ??= import("sql-formatter"));

/** The dialect names both formatters happen to share. */
const languageOf = (dialect: Dialect): "mysql" | "postgresql" =>
  dialect === "mysql" ? "mysql" : "postgresql";

async function formatStatement(
  statement: string,
  options: Required<FormatSqlOptions>,
): Promise<string> {
  const language = languageOf(options.dialect);

  try {
    const { format, plugin } = await loadPrinter();
    const formatted = await format(statement, {
      parser: language,
      plugins: [plugin],
      printWidth: options.printWidth,
      tabWidth: 2,
      sqlKeywordCase: options.keywordCase,
      // The plugin upper-cases literals and type names by default, which would rewrite `true` and
      // `numeric` even when the author asked for `preserve`. Keyword case is the one setting perch
      // exposes, so everything case-related follows it.
      sqlLiteralCase: options.keywordCase,
      sqlTypeCase: options.keywordCase,
      // `splitStatements` hands over statements with the `;` already stripped into the gap text,
      // so the printer must not add one back.
      sqlFinalSemicolon: false,
      // Canonical syntax rewrites the author's SQL — `orders o` becomes `orders AS o`. Formatting
      // moves whitespace; it does not edit what someone wrote.
      sqlCanonicalSyntax: false,
    });
    return formatted.trimEnd();
  } catch {
    // A construct the grammar does not cover, or a statement still being typed.
  }

  try {
    const { format } = await loadFallback();
    return format(statement, {
      keywordCase: options.keywordCase,
      language,
      tabWidth: 2,
    }).trimEnd();
  } catch {
    // Unparseable by either. Keep the author's text.
    return statement;
  }
}

/**
 * Formats each statement in `sql` independently.
 *
 * Per statement rather than per document because one statement neither formatter can read should
 * not cost you the formatting of the other nine, and because re-assembling the text from the
 * original gaps between statements leaves the comments, blank lines and semicolons between them
 * exactly as they were.
 */
export async function formatSql(sql: string, options: FormatSqlOptions): Promise<string> {
  const statements = splitStatements(sql);
  if (statements.length === 0) return sql;

  const resolved: Required<FormatSqlOptions> = {
    dialect: options.dialect,
    keywordCase: options.keywordCase,
    printWidth: options.printWidth ?? DEFAULT_PRINT_WIDTH,
  };

  let out = "";
  let cursor = 0;
  for (const statement of statements) {
    // Whatever sits between the previous statement and this one — the semicolon, blank lines,
    // comments — is copied verbatim.
    out += sql.slice(cursor, statement.offset);
    out += await formatStatement(statement.sql, resolved);
    cursor = statement.offset + statement.sql.length;
  }
  out += sql.slice(cursor);

  // `splitStatements` trims each statement, so a trailing newline in the source never survives
  // into `out` on its own; put back exactly one if the original had one.
  if (/\n\s*$/.test(sql) && !out.endsWith("\n")) out += "\n";

  return out;
}
