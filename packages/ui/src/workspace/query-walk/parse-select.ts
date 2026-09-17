// One SELECT, read clause by clause into character ranges.
//
// `parseTokens` is the whole file: it walks the statement's depth-zero tokens once, left to right,
// and records where each clause starts and stops. Nothing here looks INSIDE a clause — that is
// `scan-predicates.ts` — and nothing here handles a set-operator chain, which `parse-setop.ts`
// splits into branches before handing each one back to `parseTokens`.

import type { Dialect } from "@perch/protocol";
import {
  bareName,
  children,
  isAnd,
  IDENT,
  isClauseWord,
  NOT_AN_ALIAS,
  SET_OPERATORS,
  sliceTokens,
  splitItems,
  splitOn,
  splitRef,
  statementTokens,
  type Token,
  TokenCursor,
} from "./clause-tokens";
import type {
  Clause,
  Cte,
  JoinClause,
  JoinKind,
  KeyPair,
  OrderItem,
  ParsedSelect,
  Range,
  SourceRef,
  Unsupported,
} from "./clause-types";

type WithPrefix = {
  readonly ctes: Cte[];
  readonly range: Range | null;
  /** A `WITH` that named nothing we could read; the caller refuses rather than guessing. */
  readonly broken: boolean;
};

/**
 * The WITH prefix, leaving the cursor on the word after it.
 *
 * A prefix it could not read leaves the cursor exactly where it started, so a caller that refuses
 * on `broken` is looking at the run it was handed rather than at half of one.
 */
export function readWith(cur: TokenCursor): WithPrefix {
  const start = cur.mark();
  const ctes: Cte[] = [];
  if (cur.kw() !== "with") return { ctes, range: null, broken: false };
  const from = cur.token().from;
  cur.take();
  if (cur.kw() === "recursive") cur.take();
  for (;;) {
    const nameTok = cur.peek();
    if (!nameTok || nameTok.name === "Punctuation" || nameTok.name === "Parens") break;
    cur.take();
    if (cur.peek()?.name === "Parens") cur.take(); // column list
    if (cur.kw() !== "as") break;
    cur.take();
    if (cur.kw() === "not") cur.take();
    if (cur.kw() === "materialized") cur.take();
    const body = cur.peek();
    if (!body || body.name !== "Parens") break;
    cur.take();
    ctes.push({
      name: bareName(nameTok.text),
      range: { from: nameTok.from, to: body.to },
      body: { from: body.from + 1, to: body.to - 1 },
    });
    if (cur.atComma()) {
      cur.take();
      continue;
    }
    break;
  }
  const lastCte = ctes[ctes.length - 1];
  if (!lastCte) {
    cur.rewind(start);
    return { ctes, range: null, broken: true };
  }
  return { ctes, range: { from, to: lastCte.range.to }, broken: false };
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
};

/** The clauses after the FROM list, in whatever order they appear, stopping at the first word we
 *  do not recognise so a set operator or a stray tail is left for the caller. */
export function readTail(cur: TokenCursor): Tail {
  const text = cur.text;
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
    const kwFrom = cur.token().from;
    cur.take(keywordCount);
    const bodyStart = cur.mark();
    while (!cur.done && !cur.atClauseStart()) cur.take();
    const tokens = cur.since(bodyStart);
    const bodyFrom = tokens[0]?.from ?? cur.behind().to;
    const bodyTo = tokens[tokens.length - 1]?.to ?? bodyFrom;
    return {
      clause: { range: { from: kwFrom, to: bodyTo }, body: { from: bodyFrom, to: bodyTo } },
      tokens,
    };
  };

  while (!cur.done) {
    const kw = cur.kw();
    if (kw === "where") where = readClause(1).clause;
    else if (kw === "group" && cur.kw(1) === "by") {
      const read = readClause(2);
      groupBy = read.clause;
      groupTokens = read.tokens;
    } else if (kw === "having") having = readClause(1).clause;
    else if (kw === "window") window = readClause(1).clause;
    else if (kw === "order" && cur.kw(1) === "by") {
      const read = readClause(2);
      orderBy = read.clause;
      orderItems = splitItems(read.tokens).map((item) => {
        const tokens = [...item];
        let desc = false;
        // Strip `NULLS FIRST|LAST` then `ASC|DESC` from the end.
        const tail = tokens[tokens.length - 1]?.kw;
        if ((tail === "first" || tail === "last") && tokens[tokens.length - 2]?.kw === "nulls")
          tokens.splice(-2, 2);
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
    where,
    groupBy,
    groupTokens,
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
export function parseTokens(
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

  const cur = new TokenCursor(toks, text);

  /* WITH */
  const prefix = readWith(cur);
  if (prefix.broken) return { kind: "unsupported", reason: "Only SELECT queries can be walked." };
  const ctes: Cte[] = [...scopeCtes, ...prefix.ctes];
  const withRange = prefix.range;

  /* SELECT */
  if (cur.kw() !== "select") {
    return { kind: "unsupported", reason: "Only SELECT queries can be walked." };
  }
  const selectKw = cur.token();
  cur.take();
  if (cur.kw() === "all") cur.take();
  let distinct: Range | null = null;
  if (cur.kw() === "distinct") {
    const d = cur.token();
    cur.take();
    if (cur.kw() === "on" && cur.peek(1)?.name === "Parens") {
      distinct = { from: d.from, to: cur.peek(1)!.to };
      cur.take(2);
    } else {
      distinct = { from: d.from, to: d.to };
    }
  }
  const listStart = cur.mark();
  while (!cur.done && cur.kw() !== "from" && !isClauseWord(cur.kw())) cur.take();
  if (cur.mark() === listStart) {
    return { kind: "unsupported", reason: "This SELECT has no columns." };
  }
  const selectList: Range = { from: toks[listStart]!.from, to: cur.behind().to };
  const listItems = splitItems(cur.since(listStart));
  const selectItems = listItems.map((item) => stripAlias(item, text));
  const selectNames = outputNames(listItems, text);

  if (cur.kw() !== "from") {
    return {
      kind: "unsupported",
      reason: "This query has no FROM clause, so there is nothing to walk.",
    };
  }
  const fromKw = cur.token();
  cur.take();

  /* FROM list */
  /** The expression the cursor is inside has ended: a clause, a join or a comma follows. */
  const endsExpression = (): boolean =>
    cur.done || cur.atClauseStart() || cur.atJoinStart() || cur.atComma();

  const readSource = (): SourceRef | null => {
    if (cur.kw() === "lateral") cur.take();
    if (cur.kw() === "only") cur.take();
    const head = cur.peek();
    if (!head) return null;
    let kind: SourceRef["kind"];
    let name: string;
    let body: Range | null = null;
    if (head.name === "Parens") {
      kind = "derived";
      name = "subquery";
      body = { from: head.from + 1, to: head.to - 1 };
      cur.take();
    } else if (IDENT.has(head.name) || (head.kw !== null && !NOT_AN_ALIAS.has(head.kw))) {
      name = bareName(head.text);
      const cte = ctes.find((c) => c.name.toLowerCase() === name.toLowerCase());
      kind = cte && head.name !== "CompositeIdentifier" ? "cte" : "table";
      if (kind === "cte" && cte) body = cte.body;
      cur.take();
      if (cur.peek()?.name === "Parens") cur.take(); // a table function's arguments
    } else {
      return null;
    }
    let end = cur.behind().to;
    if (cur.kw() === "as") cur.take();
    let alias: string | null = null;
    const aliasTok = cur.peek();
    if (
      aliasTok &&
      (aliasTok.name === "Identifier" ||
        aliasTok.name === "QuotedIdentifier" ||
        (aliasTok.kw !== null && !NOT_AN_ALIAS.has(aliasTok.kw)))
    ) {
      alias = bareName(aliasTok.text);
      end = aliasTok.to;
      cur.take();
      if (cur.peek()?.name === "Parens") {
        end = cur.token().to;
        cur.take();
      }
    }
    return { kind, range: { from: head.from, to: end }, name, alias, body };
  };

  const first = readSource();
  if (!first) return { kind: "unsupported", reason: "Could not read the table after FROM." };
  let fromEnd = first.range.to;
  const joins: JoinClause[] = [];

  while (!cur.done) {
    const tok = cur.token();
    if (cur.atComma()) {
      cur.take();
      const source = readSource();
      if (!source) break;
      joins.push({
        kind: "cross",
        label: ",",
        range: { from: tok.from, to: source.range.to },
        keyword: { from: tok.from, to: tok.to },
        source,
        keys: [],
        using: false,
        natural: false,
      });
      fromEnd = source.range.to;
      continue;
    }
    if (!cur.atJoinStart()) break;
    const kwStart = cur.token();
    const words: string[] = [];
    let kind: JoinKind = "inner";
    let natural = false;
    while (cur.kw() !== "join") {
      const word = cur.kw()!;
      if (word === "natural") natural = true;
      if (word === "left" || word === "right" || word === "full" || word === "cross") kind = word;
      words.push(word);
      cur.take();
    }
    words.push("join");
    const joinKw = cur.token();
    cur.take();
    const source = readSource();
    if (!source) break;
    let end = source.range.to;
    let keys: KeyPair[] = [];
    let using = false;
    if (cur.kw() === "on") {
      cur.take();
      const condStart = cur.mark();
      while (!endsExpression()) cur.take();
      if (cur.mark() > condStart) {
        end = cur.behind().to;
        keys = orientKeys(extractKeys(cur.since(condStart), text), source);
      }
    } else if (cur.kw() === "using" && cur.peek(1)?.name === "Parens") {
      const parens = cur.peek(1)!;
      end = parens.to;
      using = true;
      // Everything inside `using (…)` is a column name. Nothing else can be there, so the names are
      // taken by removing the punctuation rather than by keeping what the grammar calls an
      // identifier: a dialect's keyword list wins over that test, and `using (id)` reads as a
      // KEYWORD under the PostgreSQL grammar. Filtering for identifiers dropped it — `using (id)`
      // came back with no keys at all, and `using (id, dept)` with only `dept` — so the column a
      // join actually matched on was the one column the walk would not light.
      keys = children(parens.node, text)
        .filter((child) => child.name !== "(" && child.name !== ")" && child.name !== "Punctuation")
        .map((child) => ({ left: child.text, right: child.text }));
      cur.take(2);
    }
    joins.push({
      // `NATURAL` says how the join finds its condition, not which rows it keeps: a
      // `NATURAL LEFT JOIN` is still a left join, and reading it as an inner one both narrates the
      // wrong rule and sends the walk looking for unmatched rows a left join has already kept.
      kind,
      label: words.join(" ").toUpperCase(),
      range: { from: kwStart.from, to: end },
      keyword: { from: kwStart.from, to: joinKw.to },
      source,
      keys,
      using,
      natural,
    });
    fromEnd = end;
  }

  /* The trailing clauses */
  const tail = readTail(cur);

  const groupKeys = splitItems(tail.groupTokens).map((item) => {
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

/** `sum(total) as revenue` → `sum(total)`. Only the explicit AS form is recognised. */
function stripAlias(item: readonly Token[], text: string): string {
  const n = item.length;
  if (n >= 3 && item[n - 2]?.kw === "as") return sliceTokens(item.slice(0, n - 2), text);
  return sliceTokens(item, text);
}

/** `a.x = b.y AND c.z = d.w` → pairs. Anything more elaborate yields nothing rather than a guess. */
function extractKeys(tokens: readonly Token[], text: string): { a: string; b: string }[] {
  if (tokens.length === 1 && tokens[0]!.name === "Parens") {
    const inner = children(tokens[0]!.node, text).filter(
      (child) => child.name !== "(" && child.name !== ")",
    );
    return extractKeys(inner, text);
  }
  const conjuncts = splitOn(tokens, isAnd, true);
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

/**
 * Every CTE the whole statement declares, for seeding a subquery's parse.
 *
 * A CTE named by the statement is in scope inside every subquery in it, so without this a
 * `from monthly` inside an EXISTS or a select-list subquery reads as an unknown table.
 */
export function scopeCtesOf(text: string, dialect: Dialect): Cte[] {
  const statementToks = statementTokens(text, dialect);
  return statementToks ? readWith(new TokenCursor(statementToks, text)).ctes : [];
}
