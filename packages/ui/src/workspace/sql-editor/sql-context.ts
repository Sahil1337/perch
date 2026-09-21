// What the cursor is inside, read straight off the text of one statement.
//
// The parser this answers for is `@codemirror/lang-sql`'s, and it cannot answer this: its tree is
// built for highlighting, so a half-typed `select na| from x join y` is mostly error nodes by the
// time completion runs. A hand-written tokenizer over the raw statement degrades better — every
// input here is unfinished by definition — which is why this file owns its own lexer rather than
// walking a syntax tree.
//
// Nothing in here throws. `analyzeSql` is called on every keystroke that opens the popup, and a
// crash there would take the editor's completion down for the rest of the session, so the whole
// walk is wrapped and falls back to "I don't know" instead.

export type SqlClause =
  | "start"
  | "select"
  | "from"
  | "join"
  | "on"
  | "where"
  | "groupBy"
  | "having"
  | "orderBy"
  | "limit"
  | "insertInto"
  | "insertColumns"
  | "values"
  | "update"
  | "set"
  | "returning"
  | "other";

export type TableRef = {
  schema?: string;
  table: string;
  alias?: string;
  /** A derived table or CTE: named, in scope, but with no columns anyone can resolve. */
  derived?: boolean;
};

export type SqlContext = {
  clause: SqlClause;
  /** Tables in scope for the innermost query enclosing the cursor, from its FROM and JOIN clauses. */
  tables: TableRef[];
  /**
   * The identifier immediately before the `.` the cursor is typing: `s` in `s.na|`. For a two-part
   * prefix this is the *last* part — `t` in `public.t.col|` — because that is the one to resolve
   * against aliases and table names. `qualifierPath` carries every part, so a caller that wants to
   * check the schema half has it.
   */
  qualifier?: string;
  /** Every dotted part before the cursor's word: `["public", "t"]` for `public.t.col|`. */
  qualifierPath?: string[];
};

export type TokenKind = "word" | "string" | "number" | "punct" | "operator";

export type Token = {
  kind: TokenKind;
  /** For a quoted identifier this is the unquoted name; otherwise the source text, case intact. */
  text: string;
  from: number;
  to: number;
  quoted?: boolean;
};

const WORD_START = /[A-Za-z_$\u0080-\uFFFF]/;
const WORD_CHAR = /[A-Za-z0-9_$\u0080-\uFFFF]/;
const DIGIT = /[0-9]/;
const OPERATOR_CHAR = /[+\-*/<>=!%|&^~@#?:]/;

/**
 * Words that end a table reference rather than aliasing it. `from users order by …` must not come
 * out as "the table users aliased order" — the alias slot is the only place a bare identifier is
 * ambiguous, so the check lives here and nowhere else.
 */
const RESERVED = new Set([
  "ALL",
  "AND",
  "ANY",
  "AS",
  "ASC",
  "BETWEEN",
  "BY",
  "CASE",
  "CROSS",
  "DELETE",
  "DESC",
  "DISTINCT",
  "ELSE",
  "END",
  "EXCEPT",
  "EXISTS",
  "FETCH",
  "FOR",
  "FROM",
  "FULL",
  "GROUP",
  "HAVING",
  "ILIKE",
  "IN",
  "INNER",
  "INSERT",
  "INTERSECT",
  "INTO",
  "IS",
  "JOIN",
  "LATERAL",
  "LEFT",
  "LIKE",
  "LIMIT",
  "NATURAL",
  "NOT",
  "NULL",
  "OFFSET",
  "ON",
  "OR",
  "ORDER",
  "OUTER",
  "RETURNING",
  "RIGHT",
  "SELECT",
  "SET",
  "THEN",
  "UNION",
  "UPDATE",
  "USING",
  "VALUES",
  "WHEN",
  "WHERE",
  "WINDOW",
  "WITH",
]);

const JOIN_MODIFIERS = new Set(["CROSS", "FULL", "INNER", "LEFT", "NATURAL", "OUTER", "RIGHT"]);

/** Splits a statement into tokens, dropping whitespace and comments. Never throws. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] as string;

    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f") {
      i++;
      continue;
    }

    if (char === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (char === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (char === "'") {
      const from = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      tokens.push({ from, kind: "string", text: sql.slice(from, i), to: i });
      continue;
    }

    if (char === '"' || char === "`") {
      const quote = char;
      const from = i;
      let name = "";
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            name += quote;
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          name += sql[i];
          i++;
        }
      }
      tokens.push({ from, kind: "word", quoted: true, text: name, to: i });
      continue;
    }

    if (DIGIT.test(char) || (char === "." && DIGIT.test(sql[i + 1] ?? ""))) {
      const from = i;
      while (i < sql.length && /[0-9.eE]/.test(sql[i] as string)) i++;
      tokens.push({ from, kind: "number", text: sql.slice(from, i), to: i });
      continue;
    }

    if (WORD_START.test(char)) {
      const from = i;
      while (i < sql.length && WORD_CHAR.test(sql[i] as string)) i++;
      tokens.push({ from, kind: "word", text: sql.slice(from, i), to: i });
      continue;
    }

    if (OPERATOR_CHAR.test(char)) {
      const from = i;
      while (i < sql.length && OPERATOR_CHAR.test(sql[i] as string)) i++;
      tokens.push({ from, kind: "operator", text: sql.slice(from, i), to: i });
      continue;
    }

    tokens.push({ from: i, kind: "punct", text: char, to: i + 1 });
    i++;
  }
  return tokens;
}

type Pending = { parts: string[]; alias?: string };

type Scope = {
  parent?: Scope;
  /** Paren depth this scope's `(` opened at, so the matching `)` is the one that closes it. */
  openDepth: number;
  tables: TableRef[];
  clause: SqlClause;
  /** Clause to restore on `)`, one entry per plain (non-subquery) paren group. */
  groups: SqlClause[];
  pending?: Pending;
  lastWasDot: boolean;
  expectAlias: boolean;
  /** A `(select …)` just closed in a FROM item: the name that follows is the derived table. */
  pendingDerived: boolean;
  cteMode: boolean;
  cteName?: string;
  /** A UNION arm past the cursor: its tables belong to a different query than the cursor's. */
  frozen: boolean;
};

function newScope(openDepth: number, parent?: Scope): Scope {
  return {
    clause: "start",
    cteMode: false,
    expectAlias: false,
    frozen: false,
    groups: [],
    lastWasDot: false,
    openDepth,
    parent,
    pendingDerived: false,
    tables: [],
  };
}

function flushPending(scope: Scope): void {
  const pending = scope.pending;
  scope.pending = undefined;
  scope.expectAlias = false;
  if (!pending || pending.parts.length === 0 || scope.frozen) return;
  const table = pending.parts[pending.parts.length - 1];
  if (!table) return;
  const ref: TableRef = { table };
  if (pending.parts.length > 1) ref.schema = pending.parts[pending.parts.length - 2];
  if (pending.alias) ref.alias = pending.alias;
  scope.tables.push(ref);
}

/** The keyword at `index`, upper-cased, or "" when that token is not an unquoted word. */
function keywordAt(tokens: Token[], index: number): string {
  const token = tokens[index];
  return token && token.kind === "word" && !token.quoted ? token.text.toUpperCase() : "";
}

/**
 * Where in `tokens` the cursor sits: the index of the word it is part-way through typing, or of the
 * first token that starts at or after it. A `(` or `.` that ends exactly at the cursor is *behind*
 * it and must still be walked — `insert into t (|` is inside the column list, not before it.
 */
function cursorTokenIndex(tokens: Token[], pos: number): number {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    if (token.kind === "word" && token.from < pos && token.to >= pos) return i;
    if (token.from >= pos) return i;
  }
  return tokens.length;
}

/** The dotted identifier prefix the cursor is completing against, innermost part last. */
function qualifierPath(tokens: Token[], index: number, pos: number): string[] {
  const partial = tokens[index];
  const typing = partial && partial.kind === "word" && partial.from < pos && partial.to >= pos;
  const dot = tokens[index - 1];
  if (!dot || dot.kind !== "punct" || dot.text !== ".") return [];
  if (dot.to !== (typing ? (partial as Token).from : pos)) return [];

  const parts: string[] = [];
  let at = index - 2;
  while (at >= 0) {
    const word = tokens[at];
    if (!word || word.kind !== "word") break;
    parts.unshift(word.text);
    const before = tokens[at - 1];
    if (!before || before.kind !== "punct" || before.text !== "." || before.to !== word.from) break;
    at -= 2;
  }
  return parts;
}

const TABLE_CLAUSES = new Set<SqlClause>(["from", "join", "insertInto", "update"]);

/**
 * The clause, the tables in scope and the dotted prefix at `pos` within `sql`.
 *
 * Tables come from the whole statement rather than the text before the cursor, because
 * `select na| from students s` has to know about `students`. Only the clause is read at the cursor.
 */
export function analyzeSql(sql: string, pos: number): SqlContext {
  try {
    // Deliberately not clamped to `sql.length`: the splitter trims a statement, so a cursor sitting
    // in the whitespace after it lands past the end — and that is exactly "after every token",
    // whereas clamping would read it as being part-way through the last word.
    return analyze(sql, Math.max(0, pos));
  } catch {
    return { clause: "other", tables: [] };
  }
}

function analyze(sql: string, pos: number): SqlContext {
  const tokens = tokenize(sql);
  const cursor = cursorTokenIndex(tokens, pos);

  const root = newScope(0);
  let scope = root;
  let depth = 0;
  let clauseAtCursor: SqlClause | undefined;
  let scopeAtCursor: Scope | undefined;

  for (let i = 0; i <= tokens.length; i++) {
    if (i === cursor && clauseAtCursor === undefined) {
      clauseAtCursor = scope.clause;
      scopeAtCursor = scope;
    }
    const token = tokens[i];
    if (!token) break;

    if (token.kind === "punct") {
      if (token.text === "(") {
        const next = keywordAt(tokens, i + 1);
        depth++;
        if (next === "SELECT" || next === "WITH") {
          if (TABLE_CLAUSES.has(scope.clause) && scope.groups.length === 0) {
            flushPending(scope);
            scope.pendingDerived = true;
          }
          scope = newScope(depth, scope);
        } else {
          flushPending(scope);
          scope.groups.push(scope.clause);
          if (scope.clause === "insertInto") scope.clause = "insertColumns";
        }
      } else if (token.text === ")") {
        if (scope.parent && scope.openDepth === depth) {
          scope = scope.parent;
        } else {
          flushPending(scope);
          const saved = scope.groups.pop();
          if (saved !== undefined) scope.clause = saved;
        }
        depth = Math.max(0, depth - 1);
      } else if (token.text === ",") {
        if (scope.groups.length === 0) flushPending(scope);
        scope.lastWasDot = false;
      } else if (token.text === ".") {
        scope.lastWasDot = true;
      }
      continue;
    }

    if (token.kind !== "word") {
      scope.lastWasDot = false;
      continue;
    }

    const upper = token.quoted ? "" : token.text.toUpperCase();

    if (upper === "AS") {
      // A CTE body opens with `AS (`, and the name in front of it is a table the main query sees.
      if (scope.cteMode && scope.groups.length === 0 && tokens[i + 1]?.text === "(") {
        if (scope.cteName && !scope.frozen) {
          scope.tables.push({ derived: true, table: scope.cteName });
        }
        scope.cteName = undefined;
      } else {
        scope.expectAlias = true;
      }
      scope.lastWasDot = false;
      continue;
    }

    const clause = clauseFor(upper, tokens, i);
    if (clause) {
      flushPending(scope);
      scope.lastWasDot = false;
      if (upper === "UNION" || upper === "INTERSECT" || upper === "EXCEPT") {
        // A set-operation arm is a separate query. Whichever arm the cursor is in keeps its tables:
        // before the cursor, start the set over; after it, stop collecting into this scope.
        if (clauseAtCursor === undefined) scope.tables = [];
        else scope.frozen = true;
      }
      if (upper === "WITH") scope.cteMode = true;
      else if (upper === "SELECT" || upper === "INSERT" || upper === "UPDATE" || upper === "DELETE")
        scope.cteMode = false;
      scope.clause = clause;
      continue;
    }

    if (scope.cteMode && scope.groups.length === 0) {
      if (!RESERVED.has(upper)) scope.cteName = token.text;
      scope.lastWasDot = false;
      continue;
    }

    if (!TABLE_CLAUSES.has(scope.clause) || scope.groups.length !== 0) {
      scope.lastWasDot = false;
      continue;
    }

    if (scope.pendingDerived) {
      scope.pendingDerived = false;
      scope.expectAlias = false;
      scope.lastWasDot = false;
      if (!RESERVED.has(upper) && !scope.frozen) {
        scope.tables.push({ derived: true, table: token.text });
      }
      continue;
    }

    if (scope.lastWasDot && scope.pending) {
      scope.pending.parts.push(token.text);
      scope.lastWasDot = false;
      continue;
    }
    scope.lastWasDot = false;

    if (!scope.pending) {
      if (!RESERVED.has(upper)) scope.pending = { parts: [token.text] };
      continue;
    }
    if (scope.expectAlias) {
      scope.pending.alias = token.text;
      flushPending(scope);
      continue;
    }
    if (RESERVED.has(upper) || scope.pending.alias) {
      flushPending(scope);
      continue;
    }
    scope.pending.alias = token.text;
    flushPending(scope);
  }

  let unwind: Scope | undefined = scope;
  while (unwind) {
    flushPending(unwind);
    unwind = unwind.parent;
  }

  const context: SqlContext = {
    clause: clauseAtCursor ?? scope.clause,
    tables: (scopeAtCursor ?? scope).tables,
  };
  const path = qualifierPath(tokens, cursor, pos);
  if (path.length > 0) {
    context.qualifier = path[path.length - 1];
    context.qualifierPath = path;
  }
  return context;
}

/** The clause a keyword opens, or undefined when it opens none. */
function clauseFor(upper: string, tokens: Token[], index: number): SqlClause | undefined {
  switch (upper) {
    case "SELECT":
      return "select";
    case "FROM":
      return "from";
    case "JOIN":
    case "STRAIGHT_JOIN":
      return "join";
    case "ON":
    case "USING":
      return "on";
    case "WHERE":
      return "where";
    case "HAVING":
      return "having";
    case "GROUP":
      return keywordAt(tokens, index + 1) === "BY" ? "groupBy" : undefined;
    case "ORDER":
      return keywordAt(tokens, index + 1) === "BY" ? "orderBy" : undefined;
    case "LIMIT":
    case "OFFSET":
      return "limit";
    case "INSERT":
    case "INTO":
      return "insertInto";
    case "VALUES":
      return "values";
    case "UPDATE":
      return "update";
    case "SET":
      return "set";
    case "RETURNING":
      return "returning";
    case "DELETE":
    case "WITH":
      return "start";
    case "UNION":
    case "INTERSECT":
    case "EXCEPT":
      return "start";
    default: {
      // `LEFT`/`RIGHT` are also MySQL string functions, so a modifier only opens a JOIN when the
      // word after it continues one.
      if (!JOIN_MODIFIERS.has(upper)) return undefined;
      const next = keywordAt(tokens, index + 1);
      return next === "JOIN" || JOIN_MODIFIERS.has(next) ? "join" : undefined;
    }
  }
}
