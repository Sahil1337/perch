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

const JOIN_WORDS = new Set(["join", "inner", "left", "right", "full", "cross", "natural"]);
const CLAUSE_WORDS = new Set([
  "where", "group", "having", "window", "order", "limit", "offset", "fetch", "for",
  "union", "intersect", "except",
]);
const SET_OPERATORS = new Set(["union", "intersect", "except"]);
/** Keyword-node words that cannot be a table alias. */
const NOT_AN_ALIAS = new Set([...JOIN_WORDS, ...CLAUSE_WORDS, "on", "using", "as", "lateral", "select", "with"]);

const IDENT = new Set(["Identifier", "QuotedIdentifier", "CompositeIdentifier"]);

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

export function parseSelect(text: string, dialect: Dialect): ParsedSelect | Unsupported {
  const parser = dialect === "mysql" ? MySQL.language.parser : PostgreSQL.language.parser;
  const tree = parser.parse(text);
  let statement: SyntaxNode | null = tree.topNode.firstChild;
  while (statement && statement.name !== "Statement") statement = statement.nextSibling;
  if (!statement) return { kind: "unsupported", reason: "There is no statement to walk." };

  const toks = children(statement, text).filter((token) => token.name !== ";");
  if (toks.length === 0) return { kind: "unsupported", reason: "There is no statement to walk." };
  const last = toks[toks.length - 1]!;
  const statementRange: Range = { from: toks[0]!.from, to: last.to };

  if (toks.some((token) => token.kw !== null && SET_OPERATORS.has(token.kw))) {
    return { kind: "unsupported", reason: "UNION, INTERSECT and EXCEPT are not supported yet." };
  }

  let i = 0;
  const at = (index: number): Token | undefined => toks[index];
  const kwAt = (index: number): string | null => toks[index]?.kw ?? null;

  /* WITH */
  const ctes: Cte[] = [];
  let withRange: Range | null = null;
  if (kwAt(i) === "with") {
    const start = toks[i]!.from;
    i++;
    if (kwAt(i) === "recursive") i++;
    for (;;) {
      const nameTok = at(i);
      if (!nameTok || nameTok.name === "Punctuation" || nameTok.name === "Parens") break;
      i++;
      if (at(i)?.name === "Parens") i++; // column list
      if (kwAt(i) !== "as") break;
      i++;
      if (kwAt(i) === "not") i++;
      if (kwAt(i) === "materialized") i++;
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
    if (!lastCte) return { kind: "unsupported", reason: "Only SELECT queries can be walked." };
    withRange = { from: start, to: lastCte.range.to };
  }

  /* SELECT */
  if (kwAt(i) !== "select") {
    return { kind: "unsupported", reason: "Only SELECT queries can be walked." };
  }
  const selectKw = toks[i]!;
  i++;
  if (kwAt(i) === "all") i++;
  let distinct: Range | null = null;
  if (kwAt(i) === "distinct") {
    const d = toks[i]!;
    i++;
    if (kwAt(i) === "on" && at(i + 1)?.name === "Parens") {
      distinct = { from: d.from, to: toks[i + 1]!.to };
      i += 2;
    } else {
      distinct = { from: d.from, to: d.to };
    }
  }
  const listStart = i;
  while (i < toks.length && kwAt(i) !== "from" && !(kwAt(i) !== null && CLAUSE_WORDS.has(kwAt(i)!))) i++;
  if (i === listStart) return { kind: "unsupported", reason: "This SELECT has no columns." };
  const selectList: Range = { from: toks[listStart]!.from, to: toks[i - 1]!.to };
  const selectItems = splitItems(toks.slice(listStart, i), text).map((item) => stripAlias(item, text));

  if (kwAt(i) !== "from") {
    return { kind: "unsupported", reason: "This query has no FROM clause, so there is nothing to walk." };
  }
  const fromKw = toks[i]!;
  i++;

  /* FROM list */
  const isJoinStart = (index: number): boolean => {
    let k = index;
    if (kwAt(k) === "natural") k++;
    if (kwAt(k) !== null && ["inner", "left", "right", "full", "cross"].includes(kwAt(k)!)) k++;
    if (kwAt(k) === "outer") k++;
    return kwAt(k) === "join";
  };
  const isClauseStart = (index: number): boolean => {
    const kw = kwAt(index);
    if (kw === null || !CLAUSE_WORDS.has(kw)) return false;
    if (kw === "group" || kw === "order") return kwAt(index + 1) === "by";
    return true;
  };
  const endsExpression = (index: number): boolean =>
    index >= toks.length ||
    isClauseStart(index) ||
    isJoinStart(index) ||
    (toks[index]!.name === "Punctuation" && toks[index]!.text === ",");

  const parseSource = (): SourceRef | null => {
    if (kwAt(i) === "lateral") i++;
    if (kwAt(i) === "only") i++;
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
    if (kwAt(i) === "as") i++;
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
    if (!isJoinStart(i)) break;
    const kwStart = toks[i]!;
    const words: string[] = [];
    let kind: JoinKind = "inner";
    let natural = false;
    while (kwAt(i) !== "join") {
      const word = kwAt(i)!;
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
    if (kwAt(i) === "on") {
      i++;
      const condStart = i;
      while (!endsExpression(i)) i++;
      if (i > condStart) {
        end = toks[i - 1]!.to;
        keys = orientKeys(extractKeys(toks.slice(condStart, i), text), source);
      }
    } else if (kwAt(i) === "using" && at(i + 1)?.name === "Parens") {
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
    while (i < toks.length && !isClauseStart(i)) i++;
    const tokens = toks.slice(bodyStart, i);
    const bodyFrom = tokens[0]?.from ?? toks[i - 1]!.to;
    const bodyTo = tokens[tokens.length - 1]?.to ?? bodyFrom;
    return { clause: { range: { from: kwFrom, to: bodyTo }, body: { from: bodyFrom, to: bodyTo } }, tokens };
  };

  while (i < toks.length) {
    const kw = kwAt(i);
    if (kw === "where") where = readClause(1).clause;
    else if (kw === "group" && kwAt(i + 1) === "by") {
      const read = readClause(2);
      groupBy = read.clause;
      groupTokens = read.tokens;
    } else if (kw === "having") having = readClause(1).clause;
    else if (kw === "window") window = readClause(1).clause;
    else if (kw === "order" && kwAt(i + 1) === "by") {
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

  const groupKeys = splitItems(groupTokens, text).map((item) => {
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
    fromKeyword: { from: fromKw.from, to: fromKw.to },
    from: { from: fromKw.from, to: fromEnd },
    first,
    joins,
    where,
    groupBy,
    groupKeys,
    having,
    window,
    orderBy,
    orderItems,
    limit,
    limitValue,
    offset,
    offsetValue,
  };
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
