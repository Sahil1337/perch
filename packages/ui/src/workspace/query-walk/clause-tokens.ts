// The parser toolkit the clause slicer is built on: the tree, its depth-zero tokens, and the small
// predicates that read them.
//
// The slicing rides on the editor's own grammar — keywords are `Keyword` nodes, a parenthesised
// group is one `Parens` node, and a string or comment is its own node, so a `where` inside a string
// literal never matches. Everything here is about TOKENS; what a run of them MEANS is
// `parse-select.ts`'s business.

import { MySQL, PostgreSQL } from "@codemirror/lang-sql";
import type { Dialect } from "@perch/protocol";
import type { Range } from "./clause-types";

export type SyntaxNode = ReturnType<typeof PostgreSQL.language.parser.parse>["topNode"];

/** A depth-zero token of the statement: a direct child of the `Statement` node, comments dropped. */
export type Token = {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** Lower-cased text when the node is a `Keyword`, else null. */
  readonly kw: string | null;
  readonly node: SyntaxNode;
};

export const JOIN_WORDS = new Set(["join", "inner", "left", "right", "full", "cross", "natural"]);
export const CLAUSE_WORDS = new Set([
  "where",
  "group",
  "having",
  "window",
  "order",
  "limit",
  "offset",
  "fetch",
  "for",
  "union",
  "intersect",
  "except",
]);
export const SET_OPERATORS = new Set(["union", "intersect", "except"]);
/** Keyword-node words that cannot be a table alias. */
export const NOT_AN_ALIAS = new Set([
  ...JOIN_WORDS,
  ...CLAUSE_WORDS,
  "on",
  "using",
  "as",
  "lateral",
  "select",
  "with",
]);

/** The clauses that trail a set-operator chain and belong to the whole statement, not a branch. */
export const TAIL_WORDS = new Set(["order", "limit", "offset", "fetch", "for"]);

export const IDENT = new Set(["Identifier", "QuotedIdentifier", "CompositeIdentifier"]);

export const COMPARISONS = new Set(["=", "<>", "!=", "<", ">", "<=", ">="]);

/**
 * Words that cannot be part of the expression on either side of `IN` or a comparison. Scanning
 * outward from the operator until one of these stops us is how `a + b in (select …)` keeps its
 * whole left side while `x = 1 and y in (select …)` keeps only `y`.
 */
export const EXPRESSION_STOP = new Set([
  "and",
  "or",
  "not",
  "where",
  "having",
  "on",
  "using",
  "when",
  "then",
  "else",
  "case",
  "end",
  "by",
  "select",
  "from",
  "group",
  "order",
  "limit",
  "offset",
  "join",
  "in",
  "like",
  "ilike",
  "similar",
  "between",
  "is",
  "exists",
  "any",
  "all",
  "some",
  "over",
  "partition",
  "distinct",
  "union",
  "intersect",
  "except",
  "as",
  "returning",
  "values",
  "set",
  "into",
  "with",
  "lateral",
]);

export function children(node: SyntaxNode, text: string): Token[] {
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

export function parserFor(dialect: Dialect): typeof PostgreSQL.language.parser {
  return dialect === "mysql" ? MySQL.language.parser : PostgreSQL.language.parser;
}

/** The depth-zero tokens of the first statement in `text`, or null when there is no statement. */
export function statementTokens(text: string, dialect: Dialect): Token[] | null {
  const tree = parserFor(dialect).parse(text);
  let statement: SyntaxNode | null = tree.topNode.firstChild;
  while (statement && statement.name !== "Statement") statement = statement.nextSibling;
  if (!statement) return null;
  const toks = children(statement, text).filter((token) => token.name !== ";");
  return toks.length === 0 ? null : toks;
}

/** The tokens inside a `Parens`, with the parentheses themselves dropped. */
export function parensTokens(parens: SyntaxNode, text: string): Token[] {
  return children(parens, text).filter(
    (token) => token.name !== "(" && token.name !== ")" && token.name !== ";",
  );
}

/** A `Parens` holding a query rather than a value list, which is what `in (1,2,3)` is. */
export function isSelectParens(parens: SyntaxNode, text: string): boolean {
  const head = parensTokens(parens, text)[0];
  return head?.kw === "select" || head?.kw === "with";
}

export const kwAt = (toks: readonly Token[], index: number): string | null => toks[index]?.kw ?? null;

export function isJoinStart(toks: readonly Token[], index: number): boolean {
  let k = index;
  if (kwAt(toks, k) === "natural") k++;
  const word = kwAt(toks, k);
  if (word !== null && ["inner", "left", "right", "full", "cross"].includes(word)) k++;
  if (kwAt(toks, k) === "outer") k++;
  return kwAt(toks, k) === "join";
}

export function isClauseStart(toks: readonly Token[], index: number): boolean {
  const kw = kwAt(toks, index);
  if (kw === null || !CLAUSE_WORDS.has(kw)) return false;
  if (kw === "group" || kw === "order") return kwAt(toks, index + 1) === "by";
  return true;
}

/** A clause that trails the whole set-operator chain, so the last branch must stop before it. */
export function isTailStart(toks: readonly Token[], index: number): boolean {
  const kw = kwAt(toks, index);
  if (kw === null || !TAIL_WORDS.has(kw)) return false;
  if (kw === "order") return kwAt(toks, index + 1) === "by";
  return true;
}

/** The deepest node that still holds the whole range, so a clause body nested in parentheses is
 *  read from its own parent rather than from the statement. */
export function nodeContaining(root: SyntaxNode, range: Range): SyntaxNode {
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

export function countTokensIn(toks: readonly Token[], start: number, range: Range): number {
  let n = 0;
  for (let i = start; i < toks.length && toks[i]!.to <= range.to; i++) n++;
  return n;
}

/** The operand ending just before `end`, scanning back until a word that cannot belong to it. */
export function expressionBefore(toks: readonly Token[], end: number): Range | null {
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
export function expressionAfter(toks: readonly Token[], start: number): Range | null {
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

/** `"s"."ID"` and `s.id` are the same reference; a bare `id` is not, and never matches one. */
export function normalizeRef(ref: string): string {
  const { qualifier, column } = splitRef(ref);
  return `${(qualifier ?? "").toLowerCase()}.${column.toLowerCase()}`;
}

/** Splits a token run on depth-zero commas. */
export function splitItems(tokens: readonly Token[]): Token[][] {
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

export function sliceTokens(tokens: readonly Token[], text: string): string {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!first || !last) return "";
  return text.slice(first.from, last.to);
}

export const isClauseWord = (kw: string | null): boolean => kw !== null && CLAUSE_WORDS.has(kw);


/**
 * The depth-zero tokens of `range`, read from the deepest node that still contains it.
 *
 * `dropParens` is the one thing the four callers disagree about, and it is not cosmetic: a clause
 * BODY is scanned with the enclosing parentheses dropped, because they belong to whatever the body
 * sits inside rather than to the body. A select LIST is scanned with them kept, because a run like
 * `(select …) total` is one item and dropping its parentheses would hand `splitItems` a different
 * list of pieces. Neither is the default; every caller says which it means.
 */
export function tokensInRange(
  text: string,
  range: Range,
  dialect: Dialect,
  dropParens: boolean,
): Token[] {
  const tree = parserFor(dialect).parse(text);
  const host = nodeContaining(tree.topNode, range);
  return children(host, text).filter(
    (token) =>
      token.from >= range.from &&
      token.to <= range.to &&
      (!dropParens || (token.name !== "(" && token.name !== ")")),
  );
}

/**
 * Splits a token run wherever `isSeparator` says, at depth zero.
 *
 * `keepEmpty` is what tells a list of select items from a list of conjuncts. An empty run between
 * two commas is nothing and is dropped; an empty run between two `and`s is a conjunct the caller
 * still has to see and reject, because it is the shape it cannot read rather than an absence.
 */
export function splitOn(
  tokens: readonly Token[],
  isSeparator: (token: Token) => boolean,
  keepEmpty = false,
): Token[][] {
  const runs: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (isSeparator(token)) {
      if (keepEmpty || current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (keepEmpty || current.length > 0) runs.push(current);
  return runs;
}

/** The range a run of tokens covers, or null when the run is empty. */
export function spanOf(run: readonly Token[]): Range | null {
  const first = run[0];
  const last = run[run.length - 1];
  return first && last ? { from: first.from, to: last.to } : null;
}

/** The comma `splitItems` and every `IN` list split on. */
export const isComma = (token: Token): boolean =>
  token.name === "Punctuation" && token.text === ",";

/** The `AND` a conjunct list splits on. */
export const isAnd = (token: Token): boolean => token.kw === "and";

/**
 * A place in a token run, and the only thing that moves through one.
 *
 * Every reader below this used to carry its own `let i` and advance it from inside nested closures
 * — `parseTokens` mutated one from four of them — so "where are we" was a fact spread across a
 * function rather than a value. It is one object now, and a reader that hands the run on hands this
 * on with it: `parseTokens` opens the cursor, `readWith` moves it past the WITH prefix, and
 * `readTail` picks it up wherever the FROM list left it.
 *
 * Positions are ABSOLUTE indices into the run, and `mark`/`since` are how a reader takes a slice of
 * what it just walked over. The tokens themselves carry absolute text offsets, so a range read out
 * of any run indexes the original text however deeply nested the run is.
 */
export class TokenCursor {
  private i: number;

  constructor(
    readonly toks: readonly Token[],
    readonly text: string,
    start = 0,
  ) {
    this.i = start;
  }

  /** Where the cursor is, for a caller that has to go on reading the run by hand. */
  get index(): number {
    return this.i;
  }

  get done(): boolean {
    return this.i >= this.toks.length;
  }

  /** The token `ahead` places on, or undefined past the end. */
  peek(ahead = 0): Token | undefined {
    return this.toks[this.i + ahead];
  }

  /** The keyword `ahead` places on, lower-cased, or null when that token is not a keyword. */
  kw(ahead = 0): string | null {
    return this.toks[this.i + ahead]?.kw ?? null;
  }

  /** The token the cursor is on, which the caller has already established is there. */
  token(): Token {
    return this.toks[this.i]!;
  }

  /** The token just behind the cursor: what a range that ends here ends AT. */
  behind(): Token {
    return this.toks[this.i - 1]!;
  }

  take(n = 1): void {
    this.i += n;
  }

  /** Back to where `mark` was taken, for a reader that has to undo what it read. */
  rewind(mark: number): void {
    this.i = mark;
  }

  mark(): number {
    return this.i;
  }

  /** Everything walked over since `mark`. */
  since(mark: number): Token[] {
    return this.toks.slice(mark, this.i);
  }

  atClauseStart(): boolean {
    return isClauseStart(this.toks, this.i);
  }

  atJoinStart(): boolean {
    return isJoinStart(this.toks, this.i);
  }

  /** A depth-zero comma, which separates select items, FROM sources and ORDER BY keys alike. */
  atComma(): boolean {
    const token = this.peek();
    return token !== undefined && isComma(token);
  }
}
