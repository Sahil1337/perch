// Slices one SELECT into its clauses, as character ranges into the text the user wrote.
//
// The walk's step queries are built by splicing those ranges back together, never by regenerating
// SQL, so what runs is the user's own spelling of every clause. The slicing rides on the editor's
// own grammar: keywords are `Keyword` nodes, a parenthesised group is one `Parens` node, and a
// string or comment is its own node, so a `where` inside a string literal never matches.

import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import type { Dialect } from "@perch/protocol";

export type Range = { readonly from: number; readonly to: number };

type SyntaxNode = ReturnType<typeof PostgreSQL.language.parser.parse>["topNode"];

/** A depth-zero token of the statement: a direct child of the `Statement` node, comments dropped. */
type Token = {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** Lower-cased text when the node is a `Keyword`, else null. */
  readonly kw: string | null;
  readonly node: SyntaxNode;
};

export type Cte = {
  readonly name: string;
  /** `name AS (…)`, for prepending earlier CTEs when a later one is walked on its own. */
  readonly range: Range;
  /** The text inside the parentheses. */
  readonly body: Range;
};

export type SourceRef = {
  readonly kind: "table" | "cte" | "derived";
  /** The source as written, alias included: `orders o`, `(select …) d`. */
  readonly range: Range;
  /** Bare name: no schema, no quotes. "subquery" for a derived table without an alias. */
  readonly name: string;
  readonly alias: string | null;
  /** Inside the parentheses of a derived table; the CTE's body for a CTE reference. */
  readonly body: Range | null;
};

export type KeyPair = {
  /** A column reference on the side that already existed before this join. */
  readonly left: string;
  /** A column reference on the table this join brings in. */
  readonly right: string;
};

export type JoinKind = "inner" | "left" | "right" | "full" | "cross";

export type JoinClause = {
  readonly kind: JoinKind;
  /** The join words as written and upper-cased: `LEFT OUTER JOIN`, or `,` for a comma join. */
  readonly label: string;
  /** From the first join word through the end of its ON/USING condition. */
  readonly range: Range;
  /** Just the join words, so an inner join can be re-spelled as a left join. */
  readonly keyword: Range;
  readonly source: SourceRef;
  /** Equality pairs found in the ON clause, or the USING columns. Empty when not extractable. */
  readonly keys: readonly KeyPair[];
  readonly using: boolean;
};

export type Clause = {
  /** Keyword through end of body. */
  readonly range: Range;
  /** The clause without its keyword. */
  readonly body: Range;
};

export type OrderItem = { readonly expr: string; readonly desc: boolean };

export type ParsedSelect = {
  readonly kind: "select";
  readonly text: string;
  /** The statement without a trailing semicolon. */
  readonly statement: Range;
  readonly ctes: readonly Cte[];
  /** The whole `WITH …` prefix, up to the outer SELECT. */
  readonly with: Range | null;
  /** `DISTINCT`, or `DISTINCT ON (…)`, as written. */
  readonly distinct: Range | null;
  readonly selectList: Range;
  /** `SELECT … list`. */
  readonly selectClause: Range;
  /** Each select-list item's expression, aliases stripped, for positional GROUP BY / ORDER BY. */
  readonly selectItems: readonly string[];
  /**
   * The names this SELECT's output columns have, when the text settles all of them.
   *
   * Null the moment a `*` appears anywhere in the list: what a star expands to is a fact about the
   * catalogue and not about the query, so a partial list would be worse than none — a caller
   * asking "is this one of the output columns" would get a confident no for a column the star
   * really does produce. An item that is neither an alias nor a plain column reference contributes
   * nothing: `count(*)` is named by the database, not by the text, and guessing `count` would be
   * the same mistake one item smaller.
   */
  readonly selectNames: readonly string[] | null;
  readonly fromKeyword: Range;
  /** `FROM` through the last join's condition. */
  readonly from: Range;
  readonly first: SourceRef;
  readonly joins: readonly JoinClause[];
  readonly where: Clause | null;
  readonly groupBy: Clause | null;
  /** The GROUP BY expressions, positional references resolved to the select item they name. */
  readonly groupKeys: readonly string[];
  readonly having: Clause | null;
  readonly window: Clause | null;
  readonly orderBy: Clause | null;
  readonly orderItems: readonly OrderItem[];
  readonly limit: Clause | null;
  readonly limitValue: number | null;
  readonly offset: Clause | null;
  readonly offsetValue: number | null;
};

export type Unsupported = { readonly kind: "unsupported"; readonly reason: string };

/** `UNION DISTINCT` is spelled `union` here: it means the same thing as a bare UNION, and the
 *  operator's `range` still covers the word the user wrote, which is what gets highlighted. */
export type SetOperator =
  | "union"
  | "union all"
  | "intersect"
  | "intersect all"
  | "except"
  | "except all";

export type SetBranch = {
  /** The branch's own text range in the statement. */
  readonly range: Range;
  /** The branch parsed on its own, or why it could not be. A parenthesised branch is unwrapped. */
  readonly parsed: ParsedSelect | Unsupported;
};

/**
 * A statement whose top level is a chain of set operators.
 *
 * The branch list is FLAT and precedence is NOT applied: SQL binds INTERSECT tighter than UNION and
 * EXCEPT, so `a union b intersect c` really means `a union (b intersect c)`, but this is still one
 * three-branch list. That is what the visualiser wants — a row of branches to feed the rows through
 * — so a consumer that draws the chain must say it is showing the written order rather than imply
 * that it evaluates left to right.
 */
export type ParsedSetOp = {
  readonly kind: "setop";
  readonly text: string;
  readonly statement: Range;
  /** The WITH prefix, which belongs to the whole statement and must be prepended to every branch probe. */
  readonly with: Range | null;
  readonly ctes: readonly Cte[];
  /** Two or more, in source order. */
  readonly branches: readonly SetBranch[];
  /** One per gap between branches: operators[i] joins branches[i] and branches[i+1]. */
  readonly operators: readonly { readonly op: SetOperator; readonly range: Range }[];
  /** A trailing ORDER BY / LIMIT / OFFSET that applies to the WHOLE statement, not the last branch. */
  readonly orderBy: Clause | null;
  readonly orderItems: readonly OrderItem[];
  readonly limit: Clause | null;
  readonly limitValue: number | null;
  readonly offset: Clause | null;
  readonly offsetValue: number | null;
};

export type SubqueryPredicateKind = "exists" | "not exists" | "in" | "not in" | "scalar";

export type SubqueryPredicate = {
  readonly kind: SubqueryPredicateKind;
  /** The whole predicate as written: `not exists (select …)`, `x in (select …)`. */
  readonly range: Range;
  /** Inside the subquery's parentheses. */
  readonly body: Range;
  /** For in/not in and scalar: the compared expression. Null for exists. */
  readonly left: Range | null;
  /** For scalar: the comparison operator as written (`=`, `>`, `<=`, …). */
  readonly operator: string | null;
  /** The subquery parsed on its own; a nested EXISTS inside it shows up in ITS predicates. */
  readonly parsed: ParsedSelect | Unsupported;
  /**
   * Column references inside the subquery that are qualified by something the subquery itself does
   * not define — i.e. references to the OUTER query's rows. Empty means the subquery is
   * uncorrelated and can be run once.
   */
  readonly correlated: readonly string[];
};

/**
 * A subquery written in the SELECT list, whose result is a VALUE rather than a test.
 *
 * The two shapes are the same two a predicate has, and so is what separates them: one that names
 * nothing outside itself is computed once and the same value lands on every row, while a correlated
 * one is re-run for each row and lands a different value on each. What it does NOT have is a
 * verdict — there is no boolean here for a probe to splice `true` over — which is why it carries no
 * `kind` and why `bound.ts` cannot treat it as a predicate.
 */
export type SelectSubquery = {
  /** The whole select-list item as written: the expression around the subquery, and its alias. */
  readonly item: Range;
  /** The subquery itself, parentheses included: `(select count(*) from student)`. */
  readonly range: Range;
  /** Inside those parentheses. */
  readonly body: Range;
  /** The name the item was given — `total_students` — or null when it was given none. */
  readonly alias: string | null;
  /** The subquery parsed on its own; the enclosing statement's CTEs are seeded into its scope. */
  readonly parsed: ParsedSelect | Unsupported;
  /**
   * References inside it that name something it does not define: the outer query's rows. Only
   * QUALIFIED ones count, exactly as for a predicate — an empty list means "no PROVABLE
   * correlation" and never "uncorrelated". See `correlatedIn`.
   */
  readonly correlated: readonly string[];
};

const JOIN_WORDS = new Set(["join", "inner", "left", "right", "full", "cross", "natural"]);
const CLAUSE_WORDS = new Set([
  "where", "group", "having", "window", "order", "limit", "offset", "fetch", "for",
  "union", "intersect", "except",
]);
const SET_OPERATORS = new Set(["union", "intersect", "except"]);
/** Keyword-node words that cannot be a table alias. */
const NOT_AN_ALIAS = new Set([...JOIN_WORDS, ...CLAUSE_WORDS, "on", "using", "as", "lateral", "select", "with"]);

/** The clauses that trail a set-operator chain and belong to the whole statement, not a branch. */
const TAIL_WORDS = new Set(["order", "limit", "offset", "fetch", "for"]);

const IDENT = new Set(["Identifier", "QuotedIdentifier", "CompositeIdentifier"]);

const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);

/**
 * Words that cannot be part of the expression on either side of `IN` or a comparison. Scanning
 * outward from the operator until one of these stops us is how `a + b in (select …)` keeps its
 * whole left side while `x = 1 and y in (select …)` keeps only `y`.
 */
const EXPRESSION_STOP = new Set([
  "and", "or", "not", "where", "having", "on", "using", "when", "then", "else", "case", "end",
  "by", "select", "from", "group", "order", "limit", "offset", "join", "in", "like", "ilike",
  "similar", "between", "is", "exists", "any", "all", "some", "over", "partition", "distinct",
  "union", "intersect", "except", "as", "returning", "values", "set", "into", "with", "lateral",
]);

/** Aggregates that already collapse a subquery to one row, so counting its "matches" is a lie. */
const AGGREGATES = new Set([
  "count", "sum", "avg", "min", "max", "every", "bool_and", "bool_or", "array_agg", "string_agg",
  "json_agg", "jsonb_agg", "json_object_agg", "jsonb_object_agg", "bit_and", "bit_or",
  "stddev", "stddev_pop", "stddev_samp", "variance", "var_pop", "var_samp", "group_concat",
]);

/**
 * The prefix every name the walk invents carries, so one can never collide with a name the user
 * wrote. `steps.ts` declares an identical copy today; it belongs down here, where the query
 * builders and the parser can both reach it, and `steps.ts` should re-export this one when a wave
 * next touches it — importing it the other way round would invert the layering, since `steps.ts`
 * is what imports `clauses.ts`.
 */
export const WALK_PREFIX = "_perch_walk_";

function children(node: SyntaxNode, text: string): Token[] {
  const out: Token[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LineComment" || child.name === "BlockComment") continue;
    const slice = text.slice(child.from, child.to);
    out.push({
      name: child.name,
      from: child.from,
      to: child.to,
      text: slice,
      kw: child.name === "Keyword" ? slice.toLowerCase() : null,
      node: child,
    });
  }
  return out;
}

/** `"Orders"` → `Orders`, `` `orders` `` → `orders`, `public.orders` → `orders`. */
export function bareName(ref: string): string {
  const last = splitRef(ref);
  return last.column;
}

/** Splits `o.customer_id` into its qualifier and column, quotes stripped from both. */
export function splitRef(ref: string): { qualifier: string | null; column: string } {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of ref) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === ".") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  const column = parts[parts.length - 1] ?? ref;
  const qualifier = parts.length > 1 ? (parts[parts.length - 2] ?? null) : null;
  return { qualifier, column };
}

export function isSetOp(value: ParsedSelect | ParsedSetOp | Unsupported): value is ParsedSetOp {
  return value.kind === "setop";
}

export function isUnsupported(value: ParsedSelect | ParsedSetOp | Unsupported): value is Unsupported {
  return value.kind === "unsupported";
}

function parserFor(dialect: Dialect): typeof PostgreSQL.language.parser {
  return dialect === "mysql" ? MySQL.language.parser : PostgreSQL.language.parser;
}

/** The depth-zero tokens of the first statement in `text`, or null when there is no statement. */
function statementTokens(text: string, dialect: Dialect): Token[] | null {
  const tree = parserFor(dialect).parse(text);
  let statement: SyntaxNode | null = tree.topNode.firstChild;
  while (statement && statement.name !== "Statement") statement = statement.nextSibling;
  if (!statement) return null;
  const toks = children(statement, text).filter((token) => token.name !== ";");
  return toks.length === 0 ? null : toks;
}

/** The tokens inside a `Parens`, with the parentheses themselves dropped. */
function parensTokens(parens: SyntaxNode, text: string): Token[] {
  return children(parens, text).filter(
    (token) => token.name !== "(" && token.name !== ")" && token.name !== ";",
  );
}

/** A `Parens` holding a query rather than a value list, which is what `in (1,2,3)` is. */
function isSelectParens(parens: SyntaxNode, text: string): boolean {
  const head = parensTokens(parens, text)[0];
  return head?.kw === "select" || head?.kw === "with";
}

const kwAt = (toks: readonly Token[], index: number): string | null => toks[index]?.kw ?? null;

function isJoinStart(toks: readonly Token[], index: number): boolean {
  let k = index;
  if (kwAt(toks, k) === "natural") k++;
  const word = kwAt(toks, k);
  if (word !== null && ["inner", "left", "right", "full", "cross"].includes(word)) k++;
  if (kwAt(toks, k) === "outer") k++;
  return kwAt(toks, k) === "join";
}

function isClauseStart(toks: readonly Token[], index: number): boolean {
  const kw = kwAt(toks, index);
  if (kw === null || !CLAUSE_WORDS.has(kw)) return false;
  if (kw === "group" || kw === "order") return kwAt(toks, index + 1) === "by";
  return true;
}

/** A clause that trails the whole set-operator chain, so the last branch must stop before it. */
function isTailStart(toks: readonly Token[], index: number): boolean {
  const kw = kwAt(toks, index);
  if (kw === null || !TAIL_WORDS.has(kw)) return false;
  if (kw === "order") return kwAt(toks, index + 1) === "by";
  return true;
}

type WithPrefix = {
  readonly ctes: Cte[];
  readonly range: Range | null;
  readonly next: number;
  /** A `WITH` that named nothing we could read; the caller refuses rather than guessing. */
  readonly broken: boolean;
};

function readWith(toks: readonly Token[], text: string, start: number): WithPrefix {
  let i = start;
  const ctes: Cte[] = [];
  if (kwAt(toks, i) !== "with") return { ctes, range: null, next: i, broken: false };
  const at = (index: number): Token | undefined => toks[index];
  const from = toks[i]!.from;
  i++;
  if (kwAt(toks, i) === "recursive") i++;
  for (;;) {
    const nameTok = at(i);
    if (!nameTok || nameTok.name === "Punctuation" || nameTok.name === "Parens") break;
    i++;
    if (at(i)?.name === "Parens") i++; // column list
    if (kwAt(toks, i) !== "as") break;
    i++;
    if (kwAt(toks, i) === "not") i++;
    if (kwAt(toks, i) === "materialized") i++;
    const body = at(i);
    if (!body || body.name !== "Parens") break;
    i++;
    ctes.push({
      name: bareName(nameTok.text),
      range: { from: nameTok.from, to: body.to },
      body: { from: body.from + 1, to: body.to - 1 },
    });
    if (at(i)?.name === "Punctuation" && at(i)?.text === ",") {
      i++;
      continue;
    }
    break;
  }
  const lastCte = ctes[ctes.length - 1];
  if (!lastCte) return { ctes, range: null, next: start, broken: true };
  return { ctes, range: { from, to: lastCte.range.to }, next: i, broken: false };
}

type Tail = {
  readonly where: Clause | null;
  readonly groupBy: Clause | null;
  readonly groupTokens: Token[];
  readonly having: Clause | null;
  readonly window: Clause | null;
  readonly orderBy: Clause | null;
  readonly orderItems: OrderItem[];
  readonly limit: Clause | null;
  readonly limitValue: number | null;
  readonly offset: Clause | null;
  readonly offsetValue: number | null;
  readonly next: number;
};

/** The clauses after the FROM list, in whatever order they appear, stopping at the first word we
 *  do not recognise so a set operator or a stray tail is left for the caller. */
function readTail(toks: readonly Token[], text: string, start: number): Tail {
  let i = start;
  let where: Clause | null = null;
  let groupBy: Clause | null = null;
  let having: Clause | null = null;
  let window: Clause | null = null;
  let orderBy: Clause | null = null;
  let orderItems: OrderItem[] = [];
  let limit: Clause | null = null;
  let limitValue: number | null = null;
  let offset: Clause | null = null;
  let offsetValue: number | null = null;
  let groupTokens: Token[] = [];

  const readClause = (keywordCount: number): { clause: Clause; tokens: Token[] } => {
    const kwFrom = toks[i]!.from;
    i += keywordCount;
    const bodyStart = i;
    while (i < toks.length && !isClauseStart(toks, i)) i++;
    const tokens = toks.slice(bodyStart, i);
    const bodyFrom = tokens[0]?.from ?? toks[i - 1]!.to;
    const bodyTo = tokens[tokens.length - 1]?.to ?? bodyFrom;
    return { clause: { range: { from: kwFrom, to: bodyTo }, body: { from: bodyFrom, to: bodyTo } }, tokens };
  };

  while (i < toks.length) {
    const kw = kwAt(toks, i);
    if (kw === "where") where = readClause(1).clause;
    else if (kw === "group" && kwAt(toks, i + 1) === "by") {
      const read = readClause(2);
      groupBy = read.clause;
      groupTokens = read.tokens;
    } else if (kw === "having") having = readClause(1).clause;
    else if (kw === "window") window = readClause(1).clause;
    else if (kw === "order" && kwAt(toks, i + 1) === "by") {
      const read = readClause(2);
      orderBy = read.clause;
      orderItems = splitItems(read.tokens, text).map((item) => {
        const tokens = [...item];
        let desc = false;
        // Strip `NULLS FIRST|LAST` then `ASC|DESC` from the end.
        const tail = tokens[tokens.length - 1]?.kw;
        if ((tail === "first" || tail === "last") && tokens[tokens.length - 2]?.kw === "nulls") tokens.splice(-2, 2);
        const dir = tokens[tokens.length - 1]?.kw;
        if (dir === "asc" || dir === "desc") {
          desc = dir === "desc";
          tokens.pop();
        }
        return { expr: sliceTokens(tokens, text), desc };
      });
    } else if (kw === "limit") {
      const read = readClause(1);
      limit = read.clause;
      const n = read.tokens[0];
      limitValue = n && n.name === "Number" && read.tokens.length === 1 ? Number(n.text) : null;
    } else if (kw === "offset") {
      const read = readClause(1);
      offset = read.clause;
      const n = read.tokens[0];
      offsetValue = n && n.name === "Number" ? Number(n.text) : null;
    } else if (kw === "fetch") {
      const read = readClause(1);
      limit = read.clause;
      const n = read.tokens.find((token) => token.name === "Number");
      limitValue = n ? Number(n.text) : null;
    } else if (kw === "for") {
      readClause(1);
    } else {
      break;
    }
  }

  return {
    where, groupBy, groupTokens, having, window, orderBy, orderItems,
    limit, limitValue, offset, offsetValue, next: i,
  };
}

export function parseSelect(text: string, dialect: Dialect): ParsedSelect | Unsupported {
  const toks = statementTokens(text, dialect);
  if (!toks) return { kind: "unsupported", reason: "There is no statement to walk." };
  return parseTokens(text, toks, []);
}

/**
 * One SELECT, from a token run that is already at the right depth: the statement's own children, a
 * set-operator branch, or the inside of a subquery's parentheses. Every token carries its absolute
 * position, so the ranges always index the original text no matter how deeply nested the run is.
 *
 * `scopeCtes` are the CTEs an enclosing WITH put in scope. They are prepended to whatever this run
 * declares itself, so a branch or a subquery still resolves `from x` to a CTE and can offer its
 * body — but `with` stays null for them, because the prefix belongs to the enclosing statement and
 * a probe has to take it from there.
 */
function parseTokens(
  text: string,
  toks: readonly Token[],
  scopeCtes: readonly Cte[],
): ParsedSelect | Unsupported {
  if (toks.length === 0) return { kind: "unsupported", reason: "There is no statement to walk." };
  const last = toks[toks.length - 1]!;
  const statementRange: Range = { from: toks[0]!.from, to: last.to };

  if (toks.some((token) => token.kw !== null && SET_OPERATORS.has(token.kw))) {
    return { kind: "unsupported", reason: "UNION, INTERSECT and EXCEPT are not supported yet." };
  }

  let i = 0;
  const at = (index: number): Token | undefined => toks[index];

  /* WITH */
  const prefix = readWith(toks, text, i);
  if (prefix.broken) return { kind: "unsupported", reason: "Only SELECT queries can be walked." };
  const ctes: Cte[] = [...scopeCtes, ...prefix.ctes];
  const withRange = prefix.range;
  i = prefix.next;

  /* SELECT */
  if (kwAt(toks, i) !== "select") {
    return { kind: "unsupported", reason: "Only SELECT queries can be walked." };
  }
  const selectKw = toks[i]!;
  i++;
  if (kwAt(toks, i) === "all") i++;
  let distinct: Range | null = null;
  if (kwAt(toks, i) === "distinct") {
    const d = toks[i]!;
    i++;
    if (kwAt(toks, i) === "on" && at(i + 1)?.name === "Parens") {
      distinct = { from: d.from, to: toks[i + 1]!.to };
      i += 2;
    } else {
      distinct = { from: d.from, to: d.to };
    }
  }
  const listStart = i;
  while (i < toks.length && kwAt(toks, i) !== "from" && !isClauseWord(kwAt(toks, i))) i++;
  if (i === listStart) return { kind: "unsupported", reason: "This SELECT has no columns." };
  const selectList: Range = { from: toks[listStart]!.from, to: toks[i - 1]!.to };
  const listItems = splitItems(toks.slice(listStart, i), text);
  const selectItems = listItems.map((item) => stripAlias(item, text));
  const selectNames = outputNames(listItems, text);

  if (kwAt(toks, i) !== "from") {
    return { kind: "unsupported", reason: "This query has no FROM clause, so there is nothing to walk." };
  }
  const fromKw = toks[i]!;
  i++;

  /* FROM list */
  const endsExpression = (index: number): boolean =>
    index >= toks.length ||
    isClauseStart(toks, index) ||
    isJoinStart(toks, index) ||
    (toks[index]!.name === "Punctuation" && toks[index]!.text === ",");

  const parseSource = (): SourceRef | null => {
    if (kwAt(toks, i) === "lateral") i++;
    if (kwAt(toks, i) === "only") i++;
    const head = at(i);
    if (!head) return null;
    let kind: SourceRef["kind"];
    let name: string;
    let body: Range | null = null;
    if (head.name === "Parens") {
      kind = "derived";
      name = "subquery";
      body = { from: head.from + 1, to: head.to - 1 };
      i++;
    } else if (IDENT.has(head.name) || (head.kw !== null && !NOT_AN_ALIAS.has(head.kw))) {
      name = bareName(head.text);
      const cte = ctes.find((c) => c.name.toLowerCase() === name.toLowerCase());
      kind = cte && head.name !== "CompositeIdentifier" ? "cte" : "table";
      if (kind === "cte" && cte) body = cte.body;
      i++;
      if (at(i)?.name === "Parens") i++; // a table function's arguments
    } else {
      return null;
    }
    let end = toks[i - 1]!.to;
    if (kwAt(toks, i) === "as") i++;
    let alias: string | null = null;
    const aliasTok = at(i);
    if (
      aliasTok &&
      (aliasTok.name === "Identifier" ||
        aliasTok.name === "QuotedIdentifier" ||
        (aliasTok.kw !== null && !NOT_AN_ALIAS.has(aliasTok.kw)))
    ) {
      alias = bareName(aliasTok.text);
      end = aliasTok.to;
      i++;
      if (at(i)?.name === "Parens") {
        end = toks[i]!.to;
        i++;
      }
    }
    return { kind, range: { from: head.from, to: end }, name, alias, body };
  };

  const first = parseSource();
  if (!first) return { kind: "unsupported", reason: "Could not read the table after FROM." };
  let fromEnd = first.range.to;
  const joins: JoinClause[] = [];

  while (i < toks.length) {
    const tok = toks[i]!;
    if (tok.name === "Punctuation" && tok.text === ",") {
      i++;
      const source = parseSource();
      if (!source) break;
      joins.push({
        kind: "cross",
        label: ",",
        range: { from: tok.from, to: source.range.to },
        keyword: { from: tok.from, to: tok.to },
        source,
        keys: [],
        using: false,
      });
      fromEnd = source.range.to;
      continue;
    }
    if (!isJoinStart(toks, i)) break;
    const kwStart = toks[i]!;
    const words: string[] = [];
    let kind: JoinKind = "inner";
    let natural = false;
    while (kwAt(toks, i) !== "join") {
      const word = kwAt(toks, i)!;
      if (word === "natural") natural = true;
      if (word === "left" || word === "right" || word === "full" || word === "cross") kind = word;
      words.push(word);
      i++;
    }
    words.push("join");
    const joinKw = toks[i]!;
    i++;
    const source = parseSource();
    if (!source) break;
    let end = source.range.to;
    let keys: KeyPair[] = [];
    let using = false;
    if (kwAt(toks, i) === "on") {
      i++;
      const condStart = i;
      while (!endsExpression(i)) i++;
      if (i > condStart) {
        end = toks[i - 1]!.to;
        keys = orientKeys(extractKeys(toks.slice(condStart, i), text), source);
      }
    } else if (kwAt(toks, i) === "using" && at(i + 1)?.name === "Parens") {
      const parens = toks[i + 1]!;
      end = parens.to;
      using = true;
      keys = children(parens.node, text)
        .filter((child) => IDENT.has(child.name))
        .map((child) => ({ left: child.text, right: child.text }));
      i += 2;
    }
    joins.push({
      kind: natural ? "inner" : kind,
      label: words.join(" ").toUpperCase(),
      range: { from: kwStart.from, to: end },
      keyword: { from: kwStart.from, to: joinKw.to },
      source,
      keys,
      using,
    });
    fromEnd = end;
  }

  /* The trailing clauses */
  const tail = readTail(toks, text, i);

  const groupKeys = splitItems(tail.groupTokens, text).map((item) => {
    const only = item.length === 1 ? item[0]! : null;
    if (only && only.name === "Number") {
      const position = Number(only.text);
      return selectItems[position - 1] ?? only.text;
    }
    return sliceTokens(item, text);
  });

  return {
    kind: "select",
    text,
    statement: statementRange,
    ctes,
    with: withRange,
    distinct,
    selectList,
    selectClause: { from: selectKw.from, to: selectList.to },
    selectItems,
    selectNames,
    fromKeyword: { from: fromKw.from, to: fromKw.to },
    from: { from: fromKw.from, to: fromEnd },
    first,
    joins,
    where: tail.where,
    groupBy: tail.groupBy,
    groupKeys,
    having: tail.having,
    window: tail.window,
    orderBy: tail.orderBy,
    orderItems: tail.orderItems,
    limit: tail.limit,
    limitValue: tail.limitValue,
    offset: tail.offset,
    offsetValue: tail.offsetValue,
  };
}

const isClauseWord = (kw: string | null): boolean => kw !== null && CLAUSE_WORDS.has(kw);

/**
 * The statement, whichever of the two shapes it has. A depth-zero UNION / INTERSECT / EXCEPT makes
 * it a `ParsedSetOp`; anything else is handed to `parseSelect` unchanged.
 */
export function parseStatement(text: string, dialect: Dialect): ParsedSelect | ParsedSetOp | Unsupported {
  const toks = statementTokens(text, dialect);
  if (!toks) return { kind: "unsupported", reason: "There is no statement to walk." };

  // The WITH prefix is read first so its `x as (select … union …)` parentheses — which are one
  // Parens token and therefore invisible at depth zero anyway — are never mistaken for the
  // statement's own chain, and so the branch scan starts at the first branch.
  const prefix = readWith(toks, text, 0);
  const operators: { op: SetOperator; range: Range; before: number; after: number }[] = [];
  for (let i = prefix.next; i < toks.length; i++) {
    const op = readSetOperator(toks, i);
    if (!op) continue;
    operators.push({ op: op.op, range: op.range, before: i, after: op.next });
    i = op.next - 1;
  }
  if (operators.length === 0) return parseTokens(text, toks, []);

  // A trailing ORDER BY / LIMIT / OFFSET after the last branch sorts and cuts the COMBINED result,
  // so it must come off before the last branch is parsed — otherwise `… union select b from u
  // order by 1` would show the sort as happening inside the second branch, which is not what runs.
  let tailStart = toks.length;
  for (let i = operators[operators.length - 1]!.after; i < toks.length; i++) {
    if (isTailStart(toks, i)) {
      tailStart = i;
      break;
    }
  }
  const tail = readTail(toks, text, tailStart);

  const bounds: { from: number; to: number }[] = [];
  let start = prefix.next;
  for (const op of operators) {
    bounds.push({ from: start, to: op.before });
    start = op.after;
  }
  bounds.push({ from: start, to: tailStart });

  const branches: SetBranch[] = bounds.map(({ from, to }) => {
    const run = toks.slice(from, to);
    const head = run[0];
    const tailTok = run[run.length - 1];
    if (!head || !tailTok) {
      return {
        range: { from: toks[Math.min(from, toks.length - 1)]!.from, to: toks[Math.min(from, toks.length - 1)]!.from },
        parsed: { kind: "unsupported", reason: "This branch of the set operation is empty." },
      };
    }
    // `(select …) union (select …)`: the branch's own range keeps the parentheses, because that is
    // what the user wrote and what gets highlighted, but the parse — and so any probe spliced from
    // it — works on the body, where the branch's own ORDER BY and LIMIT legitimately live.
    const inner = run.length === 1 && head.name === "Parens" && isSelectParens(head.node, text)
      ? parensTokens(head.node, text)
      : run;
    return {
      range: { from: head.from, to: tailTok.to },
      parsed: parseTokens(text, inner, prefix.ctes),
    };
  });

  return {
    kind: "setop",
    text,
    statement: { from: toks[0]!.from, to: toks[toks.length - 1]!.to },
    with: prefix.range,
    ctes: prefix.ctes,
    branches,
    operators: operators.map(({ op, range }) => ({ op, range })),
    orderBy: tail.orderBy,
    orderItems: tail.orderItems,
    limit: tail.limit,
    limitValue: tail.limitValue,
    offset: tail.offset,
    offsetValue: tail.offsetValue,
  };
}

/** What a statement DOES, once its WITH prefix has been read past. */
export type StatementKind = "select" | "values" | "write" | "other";

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
export type StatementShape = {
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
  const none: StatementShape = { kind: "other", ctes: [], with: null, from: false, verb: null, returning: false };
  const toks = statementTokens(text, dialect);
  if (!toks) return none;
  const prefix = readWith(toks, text, 0);
  // A `WITH` that named nothing readable is not a prefix: reading on from `next` would then report
  // the shape of the word `with` itself, which is no shape at all.
  const body = toks.slice(prefix.broken ? 0 : prefix.next);
  const base = { ctes: prefix.broken ? [] : prefix.ctes, with: prefix.broken ? null : prefix.range };
  const kw = body[0]?.kw ?? null;
  const has = (word: string): boolean => body.some((token) => token.kw === word);
  if (kw === "select") return { ...base, kind: "select", from: has("from"), verb: null, returning: false };
  // `TABLE t` is `SELECT * FROM t` spelled short, and like VALUES it is a whole table in one word.
  if (kw === "values" || kw === "table") return { ...base, kind: "values", from: false, verb: null, returning: false };
  if (kw !== null && WRITE_VERBS.has(kw)) {
    return { ...base, kind: "write", from: false, verb: kw, returning: has("returning") };
  }
  return { ...base, kind: "other", from: false, verb: null, returning: false };
}

/**
 * A set operator at `index`, with its `ALL` or `DISTINCT` swallowed — `union all` is a different
 * operator from `union`, and reading them as two tokens would make the second branch start at the
 * word `all`. MINUS is Oracle's spelling of EXCEPT; it is matched only if the dialect's grammar
 * calls it a Keyword, which neither of ours does today, so this costs nothing and breaks nothing.
 */
function readSetOperator(
  toks: readonly Token[],
  index: number,
): { op: SetOperator; range: Range; next: number } | null {
  const kw = kwAt(toks, index);
  if (kw === null) return null;
  const base = kw === "minus" ? "except" : kw;
  if (base !== "union" && base !== "intersect" && base !== "except") return null;
  const tok = toks[index]!;
  const modifier = kwAt(toks, index + 1);
  if (modifier === "all") {
    return { op: `${base} all` as SetOperator, range: { from: tok.from, to: toks[index + 1]!.to }, next: index + 2 };
  }
  // DISTINCT is the default, so it changes the range the UI highlights but not the operator.
  if (modifier === "distinct") {
    return { op: base, range: { from: tok.from, to: toks[index + 1]!.to }, next: index + 2 };
  }
  return { op: base, range: { from: tok.from, to: tok.to }, next: index + 1 };
}

/**
 * The depth-zero subquery predicates in a clause body, in source order. Nested ones are reachable
 * by running this again over each predicate's own `parsed` clauses, which is also how a predicate
 * two levels down gets its own correlation worked out.
 */
export function subqueryPredicates(text: string, body: Range, dialect: Dialect): SubqueryPredicate[] {
  const tree = parserFor(dialect).parse(text);
  const host = nodeContaining(tree.topNode, body);
  const toks = children(host, text).filter(
    (token) => token.from >= body.from && token.to <= body.to && token.name !== "(" && token.name !== ")",
  );

  // Any CTE the statement declares is in scope inside every subquery in it, so seed the branch
  // parses with them: without that a `from monthly` inside an EXISTS reads as an unknown table.
  const statementToks = statementTokens(text, dialect);
  const scopeCtes = statementToks ? readWith(statementToks, text, 0).ctes : [];

  const out: SubqueryPredicate[] = [];
  const build = (
    kind: SubqueryPredicateKind,
    range: Range,
    parens: Token,
    left: Range | null,
    operator: string | null,
  ): void => {
    const inner = { from: parens.from + 1, to: parens.to - 1 };
    const parsed = parseTokens(text, parensTokens(parens.node, text), scopeCtes);
    out.push({ kind, range, body: inner, left, operator, parsed, correlated: correlatedIn(parens.node, text, parsed, scopeCtes) });
  };

  let i = 0;
  while (i < toks.length) {
    const tok = toks[i]!;
    const next = toks[i + 1];
    const prev = toks[i - 1];
    const negated = prev?.kw === "not";

    if (tok.kw === "exists" && next?.name === "Parens" && isSelectParens(next.node, text)) {
      build(negated ? "not exists" : "exists", { from: (negated ? prev! : tok).from, to: next.to }, next, null, null);
      i += 2;
      continue;
    }

    if (tok.kw === "in" && next?.name === "Parens") {
      // `in (1,2,3)` is a value list, not a subquery: the parentheses hold values, and treating it
      // as a subquery would hand the walk a query it cannot run.
      if (!isSelectParens(next.node, text)) {
        i += 2;
        continue;
      }
      const left = expressionBefore(toks, negated ? i - 1 : i);
      build(
        negated ? "not in" : "in",
        { from: left?.from ?? (negated ? prev! : tok).from, to: next.to },
        next,
        left,
        null,
      );
      i += 2;
      continue;
    }

    if (tok.name === "Operator" && COMPARISONS.has(tok.text)) {
      // `= ANY (…)` and `= ALL (…)` are quantified comparisons, not scalar ones: their subquery
      // returns many rows and the walk would narrate them wrongly, so leave them alone.
      if (next?.kw === "any" || next?.kw === "all" || next?.kw === "some") {
        i += 2;
        continue;
      }
      if (next?.name === "Parens" && isSelectParens(next.node, text)) {
        const left = expressionBefore(toks, i);
        build("scalar", { from: left?.from ?? tok.from, to: next.to }, next, left, tok.text);
        i += 2;
        continue;
      }
      if (prev?.name === "Parens" && isSelectParens(prev.node, text)) {
        // Written the other way round, `(select …) > 5`. `left` is still the compared expression,
        // which here sits on the right: the caller wants the value, not the written side.
        const other = expressionAfter(toks, i + 1);
        build("scalar", { from: prev.from, to: other?.to ?? tok.to }, prev, other, tok.text);
        i = i + 1 + (other ? countTokensIn(toks, i + 1, other) : 0);
        continue;
      }
    }

    i++;
  }
  return out;
}

/**
 * The depth-zero subqueries in a select list, at most one per item, in source order.
 *
 * A select item is an expression, so the subquery can sit anywhere inside it — bare, inside a
 * `CASE`, inside a `coalesce(…)` — and the search descends through parentheses that hold values
 * until it reaches one that holds a query. It stops there and at one per item, because the item IS
 * the column: giving each half of `(select …) + (select …)` a finding of its own would claim the
 * reader wrote two columns where they wrote one.
 *
 * `list` is a `ParsedSelect.selectList`, and `text` is the text that range indexes.
 */
export function selectSubqueries(text: string, list: Range, dialect: Dialect): SelectSubquery[] {
  const tree = parserFor(dialect).parse(text);
  const host = nodeContaining(tree.topNode, list);
  const toks = children(host, text).filter(
    (token) => token.from >= list.from && token.to <= list.to,
  );

  // The same seeding `subqueryPredicates` does, for the same reason: a CTE the statement declares is
  // in scope inside this subquery too, so without it a `from monthly` here reads as an unknown table.
  const statementToks = statementTokens(text, dialect);
  const scopeCtes = statementToks ? readWith(statementToks, text, 0).ctes : [];

  const out: SelectSubquery[] = [];
  for (const item of splitItems(toks, text)) {
    const parens = selectParensIn(item, text);
    if (parens === null) continue;
    const first = item[0]!;
    const last = item[item.length - 1]!;
    const parsed = parseTokens(text, parensTokens(parens.node, text), scopeCtes);
    out.push({
      item: { from: first.from, to: last.to },
      range: { from: parens.from, to: parens.to },
      body: { from: parens.from + 1, to: parens.to - 1 },
      alias: itemAlias(item),
      parsed,
      correlated: correlatedIn(parens.node, text, parsed, scopeCtes),
    });
  }
  return out;
}

/** The first parenthesised QUERY in an item, searching inside value parentheses on the way. */
function selectParensIn(item: readonly Token[], text: string): Token | null {
  for (const token of item) {
    if (token.name !== "Parens") continue;
    if (isSelectParens(token.node, text)) return token;
    const inner = selectParensIn(children(token.node, text), text);
    if (inner !== null) return inner;
  }
  return null;
}

/**
 * The name a select item was given, or null.
 *
 * `expr as name` is settled by the keyword. The implicit form — `(select …) total` — is read only
 * when the token in front of the name cannot be continued by one, so the `y` of `x + y` is never
 * mistaken for an alias. This name is what the chapter strip shows, and a name taken off the middle
 * of an expression would send the reader looking for a column that does not exist.
 */
function itemAlias(item: readonly Token[]): string | null {
  const n = item.length;
  const last = item[n - 1];
  if (!last || n < 2) return null;
  if (n >= 3 && item[n - 2]?.kw === "as") return bareName(last.text);
  if (!IDENT.has(last.name)) return null;
  const before = item[n - 2]!;
  const ends = before.name === "Parens" || IDENT.has(before.name) || before.kw === "end";
  return ends ? bareName(last.text) : null;
}

/** The deepest node that still holds the whole range, so a clause body nested in parentheses is
 *  read from its own parent rather than from the statement. */
function nodeContaining(root: SyntaxNode, range: Range): SyntaxNode {
  let node = root;
  for (;;) {
    let descended = false;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from <= range.from && child.to >= range.to) {
        node = child;
        descended = true;
        break;
      }
    }
    if (!descended) return node;
  }
}

function countTokensIn(toks: readonly Token[], start: number, range: Range): number {
  let n = 0;
  for (let i = start; i < toks.length && toks[i]!.to <= range.to; i++) n++;
  return n;
}

/** The operand ending just before `end`, scanning back until a word that cannot belong to it. */
function expressionBefore(toks: readonly Token[], end: number): Range | null {
  let start = end;
  while (start > 0) {
    const tok = toks[start - 1]!;
    if (tok.name === "Punctuation") break;
    if (tok.kw !== null && EXPRESSION_STOP.has(tok.kw)) break;
    start--;
  }
  if (start >= end) return null;
  return { from: toks[start]!.from, to: toks[end - 1]!.to };
}

/** The operand starting at `start`, scanning forward under the same rule. */
function expressionAfter(toks: readonly Token[], start: number): Range | null {
  let end = start;
  while (end < toks.length) {
    const tok = toks[end]!;
    if (tok.name === "Punctuation") break;
    if (tok.kw !== null && EXPRESSION_STOP.has(tok.kw)) break;
    end++;
  }
  if (end <= start) return null;
  return { from: toks[start]!.from, to: toks[end - 1]!.to };
}

/** Every qualifier a SELECT puts in scope: each source by its alias if it has one, else its name,
 *  plus the CTEs it can see. */
function definedQualifiers(parsed: ParsedSelect | Unsupported): Set<string> {
  const out = new Set<string>();
  if (parsed.kind !== "select") return out;
  for (const source of [parsed.first, ...parsed.joins.map((join) => join.source)]) {
    out.add((source.alias ?? source.name).toLowerCase());
  }
  for (const cte of parsed.ctes) out.add(cte.name.toLowerCase());
  return out;
}

/**
 * The references inside a subquery that name something it does not define — the outer query's rows.
 *
 * Only QUALIFIED references count. A bare `course_id` could belong to either query and there is no
 * catalogue here to settle it, so guessing would either invent a correlation or hide one; naming
 * only what the SQL itself makes unambiguous is the honest answer.
 *
 * The walk descends through nested subqueries carrying their scopes with it, so `takes.ID` inside a
 * doubly-nested EXISTS is resolved by the FROM that actually declares `takes`, while `student.ID`
 * from the outermost query surfaces as correlated at every level that does not define it.
 */
function correlatedIn(
  parens: SyntaxNode,
  text: string,
  parsed: ParsedSelect | Unsupported,
  scopeCtes: readonly Cte[],
): string[] {
  const out: string[] = [];
  collectCorrelated(parens, text, definedQualifiers(parsed), skipRanges(parsed), scopeCtes, out);
  return out;
}

/** A plain table source is written `schema.table alias`, whose `schema.table` is a qualified
 *  reference to nothing — skipping the source's own range keeps it out of the correlation list. */
function skipRanges(parsed: ParsedSelect | Unsupported): Range[] {
  if (parsed.kind !== "select") return [];
  return [parsed.first, ...parsed.joins.map((join) => join.source)]
    .filter((source) => source.kind === "table")
    .map((source) => source.range);
}

function collectCorrelated(
  node: SyntaxNode,
  text: string,
  defined: ReadonlySet<string>,
  skip: readonly Range[],
  scopeCtes: readonly Cte[],
  out: string[],
): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LineComment" || child.name === "BlockComment" || child.name === "String") continue;
    if (skip.some((range) => child!.from >= range.from && child!.to <= range.to)) continue;
    if (child.name === "CompositeIdentifier") {
      const ref = text.slice(child.from, child.to);
      const qualifier = splitRef(ref).qualifier;
      if (qualifier && !defined.has(qualifier.toLowerCase()) && !out.includes(ref)) out.push(ref);
      continue;
    }
    if (child.name === "Parens" && isSelectParens(child, text)) {
      const inner = parseTokens(text, parensTokens(child, text), scopeCtes);
      const scope = new Set([...defined, ...definedQualifiers(inner)]);
      collectCorrelated(child, text, scope, [...skip, ...skipRanges(inner)], scopeCtes, out);
      continue;
    }
    collectCorrelated(child, text, defined, skip, scopeCtes, out);
  }
}

/**
 * The subquery rewritten to yield one row holding its match count, for a per-row probe.
 *
 * Replacing the inner query's own select list with `count(*)` in place leaves any correlation to
 * the outer row exactly where it was, and because it is done by splicing the user's ranges the
 * FROM and WHERE are still their text. This is the portable shape — it asks nothing of the dialect
 * beyond `count(*)` — so it is the first choice everywhere.
 *
 * Returns null rather than something subtly wrong when the count would not mean "matching rows".
 * `countingWrap` covers those shapes instead; only when it is refused too does the caller fall
 * back on a plain boolean.
 */
export function countingRewrite(predicate: SubqueryPredicate): string | null {
  const parsed = predicate.parsed;
  if (parsed.kind !== "select") return null;
  // GROUP BY or HAVING makes count(*) count per group, so the probe would return many rows where
  // the caller expects exactly one.
  if (parsed.groupBy !== null || parsed.having !== null) return null;
  // count(*) counts rows, not distinct ones, so it would overstate a DISTINCT subquery.
  if (parsed.distinct !== null) return null;
  // LIMIT and OFFSET cut the rows the count is meant to measure, and they apply before it here.
  if (parsed.limit !== null || parsed.offset !== null) return null;
  // An already-aggregating subquery returns one row whatever matched, so counting it yields 1 and
  // says nothing. The check reads the select-list expressions this file already extracted, not the
  // raw SQL.
  if (parsed.selectItems.some(isAggregateCall)) return null;

  const edits: { range: Range; with: string }[] = [{ range: parsed.selectList, with: "count(*)" }];
  // ORDER BY is meaningless on a single count, and once the list is an aggregate the sort key is
  // rejected outright: `select count(*) from takes order by takes.course_id` is an error, because
  // the column appears in neither an aggregate nor a GROUP BY.
  if (parsed.orderBy) edits.push({ range: parsed.orderBy.range, with: "" });
  return spliceRanges(parsed.text, parsed.statement, edits);
}

/** The derived table `countingWrap` counts from. Prefixed so it can never shadow a user alias. */
const WRAP_ALIAS = `${WALK_PREFIX}wrap`;

/**
 * The subquery wrapped so its rows are counted from outside, for the shapes `countingRewrite`
 * cannot splice (DISTINCT, GROUP BY / HAVING, LIMIT / OFFSET, an already-aggregating list).
 *
 * Postgres resolves an outer reference through the derived table, so a correlated subquery still
 * counts per outer row — verified against PostgreSQL 18. MySQL needs LATERAL for that and will
 * reject it, so a caller must treat a failure here as "fall back to a boolean" rather than as a
 * bug in the user's query.
 *
 * The body goes in untouched, which is the whole point: DISTINCT, GROUP BY and LIMIT keep their
 * meaning and the outer `count(*)` counts the rows they actually produced.
 */
export function countingWrap(predicate: SubqueryPredicate): string | null {
  const parsed = predicate.parsed;
  if (parsed.kind !== "select") return null;
  // `statement` rather than `body`: it ends at the last token, so a trailing `-- comment` inside
  // the parentheses cannot swallow the `) as …` that follows it.
  const inner = parsed.text.slice(parsed.statement.from, parsed.statement.to).trim();
  return `select count(*)\nfrom (\n${inner}\n) as ${WRAP_ALIAS}`;
}

function isAggregateCall(item: string): boolean {
  const open = item.indexOf("(");
  if (open < 0) return false;
  return AGGREGATES.has(item.slice(0, open).trim().toLowerCase());
}

/**
 * Whether the subquery already collapses to exactly one row, whatever matched.
 *
 * This is the shape `countingWrap` is a trap for: it wraps the body untouched, so counting an
 * aggregate that returns one row returns 1 for every outer row — a number that looks like a match
 * count, is not one, and cannot be told apart from a real single match once it is on screen. A
 * caller must ask this before trusting a wrapped count and show no count at all when it is true.
 * GROUP BY is deliberately not included: it returns one row PER GROUP, so counting those rows
 * really does count something the reader can see.
 */
export function collapsesToOneRow(predicate: SubqueryPredicate): boolean {
  const parsed = predicate.parsed;
  if (parsed.kind !== "select") return false;
  return parsed.groupBy === null && parsed.selectItems.some(isAggregateCall);
}

/**
 * Where each of `refs` is written inside `text`, as ranges, so a caller can splice a value over it.
 *
 * Only `CompositeIdentifier` nodes are matched, which is the same node the correlation check
 * reported them from, and the comparison goes through `splitRef` so `"s"."ID"` and `s.id` are
 * recognised as the reference `s.ID` the caller asked for. Riding on the parse rather than on a
 * search is what keeps a reference named inside a string literal or a comment from being rewritten:
 * neither is a `CompositeIdentifier`, so neither is ever returned.
 *
 * Scope is NOT re-checked, and there is one shape where that shows. A reference is only ever asked
 * for because the correlation check said it points outward, and it says that only when no scope in
 * the query defines the qualifier — so every occurrence of it normally means the same row. The
 * exception is a subquery nested inside this one that declares the very same alias: its own `s.ID`
 * is local, and this returns it alongside the outer ones. Re-deriving scope per occurrence would fix
 * it; it is not done here because an alias shadowing the outer query's alias, inside a subquery of a
 * correlated subquery, is a query nobody writes, and the cost of being wrong about it is one
 * substitution in the displayed SQL rather than a wrong answer anywhere else.
 */
export function refRanges(
  text: string,
  dialect: Dialect,
  refs: readonly string[],
): { readonly ref: string; readonly range: Range }[] {
  const wanted = new Map(refs.map((ref) => [normalizeRef(ref), ref]));
  const out: { ref: string; range: Range }[] = [];
  const visit = (node: SyntaxNode): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === "CompositeIdentifier") {
        const ref = wanted.get(normalizeRef(text.slice(child.from, child.to)));
        if (ref !== undefined) out.push({ ref, range: { from: child.from, to: child.to } });
        continue;
      }
      visit(child);
    }
  };
  visit(parserFor(dialect).parse(text).topNode);
  return out;
}

/** `"s"."ID"` and `s.id` are the same reference; a bare `id` is not, and never matches one. */
function normalizeRef(ref: string): string {
  const { qualifier, column } = splitRef(ref);
  return `${(qualifier ?? "").toLowerCase()}.${column.toLowerCase()}`;
}

/**
 * One run of a spliced statement: either text the user typed or one thing the walk wrote over it.
 *
 * The split is kept so a reader can be shown WHICH character changed. The SQL panel renders a
 * substituted run as its own element and cross-fades only that one when the bound row moves; joined
 * back together the parts are character-for-character `spliceRanges`, which is what builds them.
 */
export type SqlPart = {
  readonly text: string;
  /** The reference this run was written over (`s.ID`), or null for the user's own text. */
  readonly over: string | null;
};

/** Rebuilds `statement` with each edit's range swapped for its replacement, everything between
 *  them kept exactly as the user typed it. An edit that overlaps one already applied is dropped,
 *  which is how a reference sitting inside a replaced select list disappears with it. */
export function spliceRanges(
  text: string,
  statement: Range,
  edits: readonly { range: Range; with: string }[],
): string {
  return spliceParts(text, statement, edits)
    .map((part) => part.text)
    .join("");
}

/** `spliceRanges`, with the substitutions kept apart from the text around them. `over` is set from
 *  an edit's own `over`, so only the edits that claim one are marked as substitutions. */
export function spliceParts(
  text: string,
  statement: Range,
  edits: readonly { range: Range; with: string; over?: string }[],
): SqlPart[] {
  const ordered = [...edits].sort((a, b) => a.range.from - b.range.from);
  const parts: SqlPart[] = [];
  let cursor = statement.from;
  for (const edit of ordered) {
    if (edit.range.from < cursor || edit.range.to > statement.to) continue;
    parts.push({ text: text.slice(cursor, edit.range.from), over: null });
    parts.push({ text: edit.with, over: edit.over ?? null });
    cursor = edit.range.to;
  }
  parts.push({ text: text.slice(cursor, statement.to), over: null });
  // The trim has to survive the split, because `spliceRanges` is these parts joined and callers
  // compare its output against SQL they already have. Trimming the first and last runs in place is
  // NOT the same thing — a run that is entirely whitespace would keep the whitespace in the run
  // before it — so whole runs are dropped from each end until one has something in it. Checked
  // against the previous implementation over 20,000 random splices.
  while (parts.length > 0) {
    const first = parts[0]!;
    const text = first.text.trimStart();
    if (text === "") {
      parts.shift();
      continue;
    }
    parts[0] = { ...first, text };
    break;
  }
  while (parts.length > 0) {
    const last = parts[parts.length - 1]!;
    const text = last.text.trimEnd();
    if (text === "") {
      parts.pop();
      continue;
    }
    parts[parts.length - 1] = { ...last, text };
    break;
  }
  return parts.filter((part) => part.text !== "");
}

/** Splits a token run on depth-zero commas. */
function splitItems(tokens: readonly Token[], _text: string): Token[][] {
  const items: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.name === "Punctuation" && token.text === ",") {
      if (current.length > 0) items.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) items.push(current);
  return items;
}

function sliceTokens(tokens: readonly Token[], text: string): string {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!first || !last) return "";
  return text.slice(first.from, last.to);
}

/**
 * What the output columns of a select list are CALLED, or null when the list does not say.
 *
 * Three cases and nothing else, because anything cleverer would be a guess about the database's
 * own naming: `expr as name` is called `name`, a bare or qualified column reference is called by
 * its last part, and a star makes the whole list unknowable — `*` names whatever the catalogue
 * holds, and the one caller for this asks "is this name definitely NOT an output column", which a
 * list missing the star's columns would answer wrongly and confidently.
 */
function outputNames(items: readonly (readonly Token[])[], text: string): string[] | null {
  const names: string[] = [];
  for (const item of items) {
    const n = item.length;
    const last = item[n - 1];
    if (!last) continue;
    if (n >= 3 && item[n - 2]?.kw === "as") {
      names.push(bareName(last.text));
      continue;
    }
    // A `*`, on its own or as `t.*`, is the case that makes the whole list unknown.
    if (sliceTokens(item, text).trimEnd().endsWith("*")) return null;
    // One token, and it is a name: `i_id`, `a.i_id`, `"Total"`. Anything else — an arithmetic
    // expression, a function call, a CASE — is named by the database rather than by this text.
    if (n === 1 && IDENT.has(last.name)) names.push(bareName(last.text));
  }
  return names;
}

/**
 * The depth-zero `AND` conjuncts of a clause body, in source order.
 *
 * `a and b and c` is three separate tests a row has to pass, and both callers here care about them
 * one at a time: the program asks whether ONE of them is the subquery that emptied the result, and
 * the walk asks how many of them a row failed. An `or` anywhere at depth zero collapses the answer
 * to a single conjunct — the body as a whole — because `a and (b or c)` is three tests but
 * `a or b and c` is not, and splitting the second one would invent a structure the SQL does not
 * have. A conjunct wrapped in its own parentheses keeps them: the range is the user's text.
 */
export function conjuncts(text: string, body: Range, dialect: Dialect): Range[] {
  const tree = parserFor(dialect).parse(text);
  const host = nodeContaining(tree.topNode, body);
  const toks = children(host, text).filter(
    (token) => token.from >= body.from && token.to <= body.to && token.name !== "(" && token.name !== ")",
  );
  if (toks.some((token) => token.kw === "or")) return [body];
  const out: Range[] = [];
  let start: Token | undefined;
  let end: Token | undefined;
  for (const token of toks) {
    if (token.kw === "and") {
      if (start && end) out.push({ from: start.from, to: end.to });
      start = undefined;
      end = undefined;
      continue;
    }
    start ??= token;
    end = token;
  }
  if (start && end) out.push({ from: start.from, to: end.to });
  return out.length === 0 ? [body] : out;
}

/** `sum(total) as revenue` → `sum(total)`. Only the explicit AS form is recognised. */
function stripAlias(item: readonly Token[], text: string): string {
  const n = item.length;
  if (n >= 3 && item[n - 2]?.kw === "as") return sliceTokens(item.slice(0, n - 2), text);
  return sliceTokens(item, text);
}

/** `a.x = b.y AND c.z = d.w` → pairs. Anything more elaborate yields nothing rather than a guess. */
function extractKeys(tokens: readonly Token[], text: string): { a: string; b: string }[] {
  if (tokens.length === 1 && tokens[0]!.name === "Parens") {
    const inner = children(tokens[0]!.node, text).filter((child) => child.name !== "(" && child.name !== ")");
    return extractKeys(inner, text);
  }
  const conjuncts: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kw === "and") {
      conjuncts.push(current);
      current = [];
    } else current.push(token);
  }
  conjuncts.push(current);
  const pairs: { a: string; b: string }[] = [];
  for (const part of conjuncts) {
    const [a, op, b] = part;
    if (part.length !== 3 || !a || !op || !b) continue;
    if (op.name !== "Operator" || op.text !== "=") continue;
    if (!IDENT.has(a.name) || !IDENT.has(b.name)) continue;
    pairs.push({ a: a.text, b: b.text });
  }
  return pairs;
}

/** Puts the joined table's side of each pair on the right, where the qualifier tells. */
function orientKeys(pairs: readonly { a: string; b: string }[], source: SourceRef): KeyPair[] {
  const own = new Set([source.name.toLowerCase(), (source.alias ?? "").toLowerCase()]);
  return pairs.map(({ a, b }) => {
    const qa = splitRef(a).qualifier?.toLowerCase() ?? "";
    const qb = splitRef(b).qualifier?.toLowerCase() ?? "";
    if (own.has(qa) && !own.has(qb)) return { left: b, right: a };
    return { left: a, right: b };
  });
}
