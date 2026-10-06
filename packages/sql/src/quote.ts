// Quoting for SQL the UI writes on the user's behalf. Every name and value that goes into generated
// SQL passes through here, however ordinary it looks: a trigger called `select` or `LabelChanged`
// is legal, and spliced in bare it is either a syntax error or a different object.

import type { Dialect } from "@perch/protocol";
import { PG_QUOTED_KEYWORDS } from "./pg-keywords";

/**
 * A name Postgres reads back unchanged when it is written bare. Narrower than what the lexer
 * accepts: `$` is left out because a `$` in a bare word looks like a dollar-quote opener to both
 * statement splitters, and non-ASCII letters because `quote_ident` quotes them too.
 */
const PG_BARE = /^[a-z_][a-z0-9_]*$/;

/**
 * Quotes `name` for `dialect` only when it has to.
 *
 * Postgres matches the server's `quote_ident`: bare when the name is lower-case ASCII letters,
 * digits and underscores, starts with a letter or underscore, and is not a keyword outside the
 * unreserved category; otherwise `"…"` with `"` doubled.
 *
 * MySQL is always backticked, with `` ` `` doubled. Its reserved words change between releases
 * and there is no server here to read them from, and a backticked name is valid everywhere.
 */
export function quoteIdent(name: string, dialect: Dialect): string {
  if (dialect === "mysql") return "`" + name.replaceAll("`", "``") + "`";
  if (PG_BARE.test(name) && !PG_QUOTED_KEYWORDS.has(name)) return name;
  return '"' + name.replaceAll('"', '""') + '"';
}

/** `schema.name`, each part quoted on its own. */
export function qualified(schema: string, name: string, dialect: Dialect): string {
  return `${quoteIdent(schema, dialect)}.${quoteIdent(name, dialect)}`;
}

/**
 * A string literal. Postgres matches the server's `quote_literal`: `'` doubled, and a value with a
 * backslash written as `E'…'` with the backslashes doubled, so it reads back the same whatever
 * `standard_conforming_strings` says. MySQL doubles `'` and escapes backslashes, which is right
 * unless the session runs with `NO_BACKSLASH_ESCAPES`.
 */
export function quoteLiteral(value: string, dialect: Dialect): string {
  if (dialect === "mysql") return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
  const quoted = `'${value.replaceAll("'", "''")}'`;
  return value.includes("\\") ? `E${quoted.replaceAll("\\", "\\\\")}` : quoted;
}
