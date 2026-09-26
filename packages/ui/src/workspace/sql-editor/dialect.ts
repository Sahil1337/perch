// A `$$ ... $$` body is one String token to the SQL grammar, and the grammar is right: to the
// server that body *is* a string literal. It is also where every PL/pgSQL block lives, so a whole
// `DO` block paints in one flat colour. Parsing the body as SQL a second time, as an overlay, puts
// the keywords back without the outer grammar having to know what PL/pgSQL is.

import { MySQL, PostgreSQL, SQLDialect } from "@codemirror/lang-sql";
import { type Input, type NestedParse, type SyntaxNodeRef, parseMixed } from "@lezer/common";
import type { Dialect } from "@perch/protocol";

/**
 * The body's own dialect. Postgres' keyword list already carries PL/pgSQL's vocabulary — `raise`,
 * `notice`, `loop`, `elsif`, `perform` and `exception` are all in it — so the only additions are
 * the two types a block can declare that a table column cannot.
 */
const PLpgSQL = SQLDialect.define({
  ...PostgreSQL.spec,
  types: `${PostgreSQL.spec.types ?? ""} record refcursor`,
});

/** `$$`, or `$tag$` — the same shape `@perch/sql`'s splitter skips. */
const OPENING_TAG = /^\$(?:[A-Za-z_-￿][A-Za-z0-9_-￿]*)?\$/;

function dollarQuotedBody(node: SyntaxNodeRef, input: Input): NestedParse | null {
  if (node.name !== "String") return null;
  const text = input.read(node.from, node.to);
  const tag = OPENING_TAG.exec(text)?.[0];
  // A half-typed block has no closing tag yet, and its String node runs to the end of the
  // document. Leaving it flat for those few keystrokes beats repainting the rest of the file.
  if (!tag || text.length < tag.length * 2 || !text.endsWith(tag)) return null;
  return {
    parser: PLpgSQL.language.parser,
    overlay: [{ from: node.from + tag.length, to: node.to - tag.length }],
  };
}

// The overlay hangs off the outer dialect only. `PLpgSQL` itself is unwrapped, so a `$$` inside a
// body closes the nesting rather than opening another one.
const PostgresWithBlocks = PostgreSQL.configureLanguage({ wrap: parseMixed(dollarQuotedBody) });

export function dialectFor(dialect: Dialect): SQLDialect {
  return dialect === "mysql" ? MySQL : PostgresWithBlocks;
}
