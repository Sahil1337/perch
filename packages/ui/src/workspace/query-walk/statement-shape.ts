// What KIND of statement the text is, before anything tries to slice it into clauses.

import type { Dialect } from "@perch/protocol";
import { statementTokens, TokenCursor } from "./clause-tokens";
import type { Cte, Range } from "./clause-types";
import { readWith } from "./parse-select";

/** What a statement DOES, once its WITH prefix has been read past. */
type StatementKind = "select" | "values" | "write" | "other";

/**
 * A shallow reading of a statement the clause slicer may well refuse.
 *
 * `parseSelect` answers one question — can this be walked clause by clause — and says "unsupported"
 * to everything else, which is the right contract for it and the wrong one for deciding what to DO
 * with a CTE. `with v as (values (1),(2))` is not walkable and is also not broken: it runs, it
 * returns rows, and a chapter that shows those rows is the honest thing to build. So this reports
 * the SHAPE and leaves the judgement to the caller.
 *
 * The WITH prefix is read first and reported whatever the body turns out to be, because a CTE list
 * is still a list of things to compute even when the query that reads them is a bare `select 1`.
 */
type StatementShape = {
  readonly kind: StatementKind;
  /** The WITH prefix's CTEs, with ranges into `text`. Empty when there is no WITH. */
  readonly ctes: readonly Cte[];
  readonly with: Range | null;
  /** `select` only: whether it has a FROM at its own depth. A FROM inside a subquery is inside a
   *  `Parens` token and is deliberately invisible here — it belongs to that subquery, not this. */
  readonly from: boolean;
  /** `write` only: `insert`, `update`, `delete` or `merge`, as the grammar spelled it. */
  readonly verb: string | null;
  /** `write` only: it has a RETURNING, so it hands rows back as well as changing them. */
  readonly returning: boolean;
};

/** The verbs that change the database. Nothing the walk builds may ever probe one of these. */
const WRITE_VERBS = new Set(["insert", "update", "delete", "merge", "replace", "upsert"]);

export function statementShape(text: string, dialect: Dialect): StatementShape {
  const none: StatementShape = {
    kind: "other",
    ctes: [],
    with: null,
    from: false,
    verb: null,
    returning: false,
  };
  const toks = statementTokens(text, dialect);
  if (!toks) return none;
  const cur = new TokenCursor(toks, text);
  const prefix = readWith(cur);
  // A `WITH` that named nothing readable is not a prefix: reading on from `next` would then report
  // the shape of the word `with` itself, which is no shape at all.
  const body = toks.slice(prefix.broken ? 0 : cur.index);
  const base = {
    ctes: prefix.broken ? [] : prefix.ctes,
    with: prefix.broken ? null : prefix.range,
  };
  const kw = body[0]?.kw ?? null;
  const has = (word: string): boolean => body.some((token) => token.kw === word);
  if (kw === "select")
    return { ...base, kind: "select", from: has("from"), verb: null, returning: false };
  // `TABLE t` is `SELECT * FROM t` spelled short, and like VALUES it is a whole table in one word.
  if (kw === "values" || kw === "table")
    return { ...base, kind: "values", from: false, verb: null, returning: false };
  if (kw !== null && WRITE_VERBS.has(kw)) {
    return { ...base, kind: "write", from: false, verb: kw, returning: has("returning") };
  }
  return { ...base, kind: "other", from: false, verb: null, returning: false };
}
