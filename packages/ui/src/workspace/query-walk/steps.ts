// From the sliced clauses to the ordered stations, each with the SQL it samples and counts.
//
// Every query is the user's own text spliced together, so the "SQL that ran" block can show it and
// it means what the user wrote. A newline goes before anything appended: a `-- comment` at the end
// of a clause would otherwise swallow the `limit` that follows it.

import { bareName, type JoinClause, type ParsedSelect, type Range, type SourceRef, WALK_PREFIX } from "./clauses";

/** The one definition lives in `clauses.ts`, where the parser and the query builders can both
 *  reach it; this keeps the name importable from here, which is where it was first spelled. */
export { WALK_PREFIX };

export type StationId =
  | "from"
  | "join"
  | "where"
  | "group"
  | "having"
  | "window"
  | "select"
  | "distinct"
  | "order"
  | "limit";

/** Rows a sample asks for. The server caps at the same number through `maxRows`. */
export const SAMPLE_ROWS = 25;

/** Output columns the walk adds for its own bookkeeping; never shown. */
export const PASS_COLUMN = `${WALK_PREFIX}pass`;
export const keyColumn = (index: number): string => `${WALK_PREFIX}k${index}`;
/** The window function's own value, computed a second time under a name the walk owns. Without it
 *  the scene would have to guess which of the user's output columns the function produced, and a
 *  query with no alias, a `*`, or two functions in a row makes that guess wrong. */
export const WINDOW_COLUMN = `${WALK_PREFIX}win`;
/** One boolean per WHEN of a CASE: true on the rows that branch would claim, before the branches
 *  ahead of it get their turn. */
export const branchColumn = (index: number): string => `${WALK_PREFIX}b${index}`;

export type Query = {
  /** `sample`, `count`, `verdict`, `pre`, `pairs`, or `src0.sample` at FROM. */
  readonly id: string;
  readonly label: string;
  readonly sql: string;
};

export type Station = {
  /** Unique across the walk; joins carry their index. */
  readonly key: string;
  readonly id: StationId;
  readonly label: string;
  /** False when the query has no such clause: listed on the rail, skipped by playback. */
  readonly present: boolean;
  /** The clause in the user's text, for the narrator's highlight. */
  readonly clause: Range | null;
  /** Each batch is one probe call, so a failure in one leaves the others untouched. */
  readonly batches: readonly (readonly Query[])[];
  /** Which join this station is, when it is one. */
  readonly join: JoinClause | null;
  readonly joinIndex: number;
};

const ABSENT: Station["batches"] = [];

/** `orders o`, `customers`, `subquery d`. */
export function sourceTitle(source: SourceRef): string {
  return source.alias && source.alias !== source.name ? `${source.name} ${source.alias}` : source.name;
}

/* ── Inside one select-list item ───────────────────────────────────────────────────────────────
 *
 * `clauses.ts` already split the list on its depth-zero commas, so every item below is a verbatim
 * slice of the user's text and nothing here ever crosses into the next one. What is left is to
 * find `over` and `case` inside an item, which the pieces below do the same way the parser does
 * one level up: a string literal, a comment and a parenthesised group are each swallowed whole, so
 * a `case` written inside one is never mistaken for the keyword. Everything these return is a
 * slice of the item, never a re-spelling of it — the station queries splice those slices straight
 * back in.
 */

/** A bare word, a parenthesised group, a literal or an operator, with its offsets into the item. */
type Piece = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** Lower-cased text when the piece is an unqualified bare word, else null. */
  readonly word: string | null;
};

const WORD_CHAR = /[A-Za-z0-9_$.]/;
const BARE_WORD = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** Past the literal or quoted name opening at `start`; a doubled quote continues it rather than
 *  ending it, which is how `'it''s'` stays one literal. */
function endOfQuoted(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] !== quote) i++;
    else if (text[i + 1] === quote) i += 2;
    else return i + 1;
  }
  return text.length;
}

function endOfComment(text: string, start: number): number {
  if (text[start + 1] === "-") {
    const newline = text.indexOf("\n", start);
    return newline < 0 ? text.length : newline + 1;
  }
  const close = text.indexOf("*/", start + 2);
  return close < 0 ? text.length : close + 2;
}

const opensComment = (text: string, i: number): boolean =>
  (text[i] === "-" && text[i + 1] === "-") || (text[i] === "/" && text[i + 1] === "*");

/** Past the group opening at `start`. Literals and comments inside it are skipped, so a `)` typed
 *  inside a string never closes the group early. */
function endOfGroup(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'" || ch === '"' || ch === "`") i = endOfQuoted(text, i);
    else if (opensComment(text, i)) i = endOfComment(text, i);
    else {
      if (ch === "(") depth += 1;
      else if (ch === ")" && (depth -= 1) === 0) return i + 1;
      i += 1;
    }
  }
  return text.length;
}

function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (opensComment(text, i)) {
      i = endOfComment(text, i);
      continue;
    }
    const from = i;
    if (ch === "(") i = endOfGroup(text, i);
    else if (ch === "'" || ch === '"' || ch === "`") i = endOfQuoted(text, i);
    else if (WORD_CHAR.test(ch)) while (i < text.length && WORD_CHAR.test(text[i]!)) i += 1;
    else i += 1;
    const slice = text.slice(from, i);
    out.push({ from, to: i, text: slice, word: BARE_WORD.test(slice) ? slice.toLowerCase() : null });
  }
  return out;
}

const textOf = (source: string, list: readonly Piece[]): string =>
  list.length === 0 ? "" : source.slice(list[0]!.from, list[list.length - 1]!.to);

/** Splits a run of pieces on its depth-zero commas: a comma inside a group is inside one piece. */
function splitCommas(source: string, list: readonly Piece[]): string[] {
  const out: string[] = [];
  let current: Piece[] = [];
  for (const piece of list) {
    if (piece.text === ",") {
      if (current.length > 0) out.push(textOf(source, current));
      current = [];
    } else current.push(piece);
  }
  if (current.length > 0) out.push(textOf(source, current));
  return out;
}

export type WindowFn = {
  /** The whole expression as written, `over` and its spec included. */
  readonly expr: string;
  /** Just the call: `rank()`, `avg(salary)`. */
  readonly call: string;
  /** The PARTITION BY expressions, as written. Empty when the whole result is one pane. */
  readonly partition: readonly string[];
  /** The frame's ORDER BY items, as written, `desc` and all. */
  readonly order: readonly string[];
  /** The named window it was written against, when it used one. */
  readonly named: string | null;
};

/** Words that end the expression list before them inside an OVER spec. */
const SPEC_WORDS = new Set(["partition", "order", "rows", "range", "groups", "exclude"]);

const at = (list: readonly Piece[], index: number): string | null => list[index]?.word ?? null;

/** The expressions between `start` and the next word that ends them. */
function specList(spec: string, list: readonly Piece[], start: number): { items: string[]; next: number } {
  let i = start;
  while (i < list.length && !(list[i]!.word !== null && SPEC_WORDS.has(list[i]!.word!))) i += 1;
  return { items: splitCommas(spec, list.slice(start, i)), next: i };
}

/**
 * The partition and frame order an OVER spec asks for. A spec may open with the name of another
 * window (`over (w order by hired)`), which inherits that window's partition and only overrides
 * what it spells out; `seen` is what stops a window defined in terms of itself from looping.
 */
function readSpec(
  spec: string,
  named: ReadonlyMap<string, string>,
  seen: ReadonlySet<string>,
): { partition: readonly string[]; order: readonly string[] } {
  const list = pieces(spec);
  let partition: readonly string[] = [];
  let order: readonly string[] = [];
  let i = 0;
  const head = at(list, 0);
  if (head !== null && !SPEC_WORDS.has(head) && named.has(head) && !seen.has(head)) {
    const base = readSpec(named.get(head)!, named, new Set([...seen, head]));
    partition = base.partition;
    order = base.order;
    i = 1;
  }
  while (i < list.length) {
    if (at(list, i) === "partition" && at(list, i + 1) === "by") {
      const read = specList(spec, list, i + 2);
      partition = read.items;
      i = read.next;
    } else if (at(list, i) === "order" && at(list, i + 1) === "by") {
      const read = specList(spec, list, i + 2);
      order = read.items;
      i = read.next;
    } else i += 1;
  }
  return { partition, order };
}

/** `WINDOW w AS (…), v AS (…)` by name, so `over w` can be resolved to what it stands for. */
function namedWindows(parsed: ParsedSelect): Map<string, string> {
  const out = new Map<string, string>();
  if (!parsed.window) return out;
  const body = parsed.text.slice(parsed.window.body.from, parsed.window.body.to);
  for (const definition of splitCommas(body, pieces(body))) {
    const list = pieces(definition);
    const spec = list[2];
    if (!list[0] || at(list, 1) !== "as" || !spec?.text.startsWith("(")) continue;
    out.set(bareName(list[0].text).toLowerCase(), spec.text.slice(1, -1));
  }
  return out;
}

/** Every window function in the select list, in the order it was written. */
export function windowFunctions(parsed: ParsedSelect): WindowFn[] {
  const named = namedWindows(parsed);
  const out: WindowFn[] = [];
  for (const item of parsed.selectItems) {
    const list = pieces(item);
    const over = list.findIndex((piece) => piece.word === "over");
    const spec = list[over + 1];
    // `over` as the first piece is not a call being windowed, it is a column someone named `over`.
    if (over < 1 || !spec) continue;
    const inline = spec.text.startsWith("(");
    const name = inline ? null : bareName(spec.text).toLowerCase();
    const body = inline ? spec.text.slice(1, -1) : (named.get(name!) ?? null);
    if (body === null) continue;
    out.push({
      expr: item.slice(list[0]!.from, spec.to),
      call: item.slice(list[0]!.from, list[over - 1]!.to),
      named: name,
      ...readSpec(body, named, new Set(name === null ? [] : [name])),
    });
  }
  return out;
}

export type CaseBranch = { readonly when: string; readonly then: string };

export type CaseExpr = {
  /** `case … end`, as written. */
  readonly expr: string;
  readonly branches: readonly CaseBranch[];
  /** The ELSE result as written; null when there is none, and an unmatched row comes out null. */
  readonly fallback: string | null;
};

const ENDS_RESULT = new Set(["when", "else", "end", "case"]);

/** Past `start`, the first piece whose word is one of `stop`; `list.length` when none is. */
function until(list: readonly Piece[], start: number, stop: ReadonlySet<string>): number {
  let i = start;
  while (i < list.length && !(list[i]!.word !== null && stop.has(list[i]!.word!))) i += 1;
  return i;
}

/**
 * Every `CASE WHEN … THEN … END` in the select list, branch by branch.
 *
 * Only the searched form is read. The simple form (`case salary when 90000 then …`) compares each
 * WHEN against an operand, and the walk would have to write that comparison itself to test a
 * branch on its own — which is the one thing this module does not do. A CASE nested inside another
 * at the same depth is given up on for the same reason: half a reading is worse than none.
 */
export function caseExpressions(parsed: ParsedSelect): CaseExpr[] {
  const out: CaseExpr[] = [];
  for (const item of parsed.selectItems) {
    const list = pieces(item);
    const start = list.findIndex((piece) => piece.word === "case");
    if (start < 0 || at(list, start + 1) !== "when") continue;
    const branches: CaseBranch[] = [];
    let fallback: string | null = null;
    let end = -1;
    let i = start + 1;
    while (i < list.length) {
      const word = at(list, i);
      if (word === "when") {
        const then = until(list, i + 1, new Set(["then", "case", "end"]));
        if (at(list, then) !== "then") break;
        const next = until(list, then + 1, ENDS_RESULT);
        if (next >= list.length) break;
        branches.push({
          when: textOf(item, list.slice(i + 1, then)),
          then: textOf(item, list.slice(then + 1, next)),
        });
        i = next;
      } else if (word === "else") {
        const close = until(list, i + 1, new Set(["end", "case"]));
        if (at(list, close) !== "end") break;
        fallback = textOf(item, list.slice(i + 1, close));
        i = close;
      } else if (word === "end") {
        end = list[i]!.to;
        break;
      } else break;
    }
    if (end < 0 || branches.length === 0) continue;
    out.push({ expr: item.slice(list[start]!.from, end), branches, fallback });
  }
  return out;
}

/**
 * Where the narrator points for a window function: at the WINDOW clause when the function was
 * written against a named window, because that is where the partition is spelled, and otherwise at
 * the expression itself, found by the text it was sliced from.
 */
function windowRange(parsed: ParsedSelect, fn: WindowFn): Range | null {
  if (fn.named !== null && parsed.window) return parsed.window.range;
  const found = parsed.text.indexOf(fn.expr, parsed.selectList.from);
  return found < 0 || found >= parsed.selectList.to
    ? parsed.selectList
    : { from: found, to: found + fn.expr.length };
}

export function buildStations(parsed: ParsedSelect): Station[] {
  const { text } = parsed;
  const slice = (range: Range): string => text.slice(range.from, range.to);
  const withPrefix = parsed.with ? `${slice(parsed.with)}\n` : "";
  const lines = (...parts: (string | null | undefined)[]): string =>
    parts.filter((part): part is string => Boolean(part)).join("\n");
  const limited = (sql: string): string => `${withPrefix}${sql}\nlimit ${SAMPLE_ROWS}`;
  const counted = (sql: string): string =>
    `${withPrefix}select count(*) from (\n${sql}\n) as ${WALK_PREFIX}count`;

  const list = slice(parsed.selectList);
  const fullFrom = slice(parsed.from);
  const where = parsed.where ? slice(parsed.where.range) : null;
  const groupBy = parsed.groupBy ? slice(parsed.groupBy.range) : null;
  const having = parsed.having ? slice(parsed.having.range) : null;
  const window = parsed.window ? slice(parsed.window.range) : null;
  const orderBy = parsed.orderBy ? slice(parsed.orderBy.range) : null;
  const distinct = parsed.distinct ? slice(parsed.distinct) : null;

  const sample = (sql: string): Query => ({ id: "sample", label: "Sample", sql: limited(sql) });
  const count = (sql: string): Query => ({ id: "count", label: "Count", sql: counted(sql) });

  const stations: Station[] = [];

  /* FROM: one card per source, each its own probe so a missing table only fails its own card. */
  const sources = [parsed.first, ...parsed.joins.map((join) => join.source)];
  stations.push({
    key: "from",
    id: "from",
    label: "FROM",
    present: true,
    clause: { from: parsed.fromKeyword.from, to: parsed.first.range.to },
    batches: sources.map((source, index) => [
      { id: `src${index}.sample`, label: `Sample of ${sourceTitle(source)}`, sql: limited(`select *\nfrom ${slice(source.range)}`) },
      { id: `src${index}.count`, label: `Count of ${sourceTitle(source)}`, sql: `${withPrefix}select count(*)\nfrom ${slice(source.range)}` },
    ]),
    join: null,
    joinIndex: -1,
  });

  /* JOIN n: the FROM list up to and including join n. */
  if (parsed.joins.length === 0) {
    stations.push({ key: "join", id: "join", label: "JOIN", present: false, clause: null, batches: ABSENT, join: null, joinIndex: -1 });
  }
  parsed.joins.forEach((join, index) => {
    const through = `select *\n${text.slice(parsed.fromKeyword.from, join.range.to)}`;
    const queries: Query[] = [sample(through), count(through)];
    if (join.kind === "inner" && join.label !== ",") {
      // The same chain with this join spelled as a left join: the rows an inner join drops are the
      // ones that come back with nothing on the right.
      const pairs =
        `select *\n${text.slice(parsed.fromKeyword.from, join.keyword.from)}left join${text.slice(join.keyword.to, join.range.to)}`;
      queries.push({ id: "pairs", label: "Every pairing (as a left join)", sql: limited(pairs) });
    }
    stations.push({
      key: `join${index}`,
      id: "join",
      label: parsed.joins.length > 1 ? `JOIN ${index + 1}` : "JOIN",
      present: true,
      clause: join.range,
      batches: [queries],
      join,
      joinIndex: index,
    });
  });

  /* WHERE */
  {
    const base = lines("select *", fullFrom, where);
    const queries: Query[] = parsed.where
      ? [
          sample(base),
          count(base),
          {
            id: "verdict",
            label: "Row test",
            sql: limited(lines(`select *, (${slice(parsed.where.body)}) as ${PASS_COLUMN}`, fullFrom)),
          },
        ]
      : [];
    stations.push({ key: "where", id: "where", label: "WHERE", present: parsed.where !== null, clause: parsed.where?.range ?? null, batches: parsed.where ? [queries] : ABSENT, join: null, joinIndex: -1 });
  }

  /* GROUP BY: the grouped rows, plus the rows before grouping ordered by the keys. */
  const keyColumns = parsed.groupKeys.map((key, index) => `(${key}) as ${keyColumn(index)}`);
  const grouped = lines(`select ${list}`, fullFrom, where, groupBy, window);
  {
    const queries: Query[] = parsed.groupBy
      ? [
          sample(lines(`select ${list}, ${keyColumns.join(", ")}`, fullFrom, where, groupBy, window)),
          count(grouped),
          {
            id: "pre",
            label: "Rows before grouping, ordered by the keys",
            sql: limited(
              lines(
                `select *, ${keyColumns.join(", ")}`,
                fullFrom,
                where,
                `order by ${parsed.groupKeys.map((_, index) => keyColumn(index)).join(", ")}`,
              ),
            ),
          },
        ]
      : [];
    stations.push({ key: "group", id: "group", label: "GROUP BY", present: parsed.groupBy !== null, clause: parsed.groupBy?.range ?? null, batches: parsed.groupBy ? [queries] : ABSENT, join: null, joinIndex: -1 });
  }

  /* HAVING */
  const withHaving = lines(`select ${list}`, fullFrom, where, groupBy, having, window);
  {
    const queries: Query[] = parsed.having
      ? [
          sample(withHaving),
          count(withHaving),
          {
            id: "verdict",
            label: "Group test",
            sql: limited(lines(`select ${list}, (${slice(parsed.having.body)}) as ${PASS_COLUMN}`, fullFrom, where, groupBy, window)),
          },
        ]
      : [];
    stations.push({ key: "having", id: "having", label: "HAVING", present: parsed.having !== null, clause: parsed.having?.range ?? null, batches: parsed.having ? [queries] : ABSENT, join: null, joinIndex: -1 });
  }

  /* WINDOW: the rows HAVING left, each one given the window function's value.
   *
   * It sits here because a window function sees the rows grouping already settled — which is the
   * whole reason ORDER BY may sort by one and WHERE cannot mention one at all. The partition
   * expressions ride along as key columns so the scene can gather the rows into panes without
   * re-deriving them, and the function itself is computed a second time under a name the walk
   * owns. The count is only here to show the number did not move: unlike GROUP BY, a pane keeps
   * every row it holds.
   */
  const windows = windowFunctions(parsed);
  {
    const fn = windows[0];
    const keys = fn ? fn.partition.map((key, index) => `(${key}) as ${keyColumn(index)}`) : [];
    // Panes first, then the order the function walks them in, so the sample arrives looking like
    // what it is. Both are the user's own expressions; the key columns are ordered by their alias
    // because a partition on an expression has no column name to name.
    const paneOrder = fn ? [...fn.partition.map((_, index) => keyColumn(index)), ...fn.order] : [];
    const probe = fn
      ? lines(
          `select ${[list, ...keys, `(${fn.expr}) as ${WINDOW_COLUMN}`].join(", ")}`,
          fullFrom,
          where,
          groupBy,
          having,
          window,
          paneOrder.length > 0 ? `order by ${paneOrder.join(", ")}` : null,
        )
      : "";
    stations.push({
      key: "window",
      id: "window",
      label: "WINDOW",
      present: fn !== undefined,
      clause: fn ? windowRange(parsed, fn) : null,
      batches: fn ? [[sample(probe), count(withHaving)]] : ABSENT,
      join: null,
      joinIndex: -1,
    });
  }

  /* SELECT: the output columns. Same row count as the station before it, so no count. */
  {
    const queries: Query[] = [sample(withHaving)];
    const branches = caseExpressions(parsed)[0];
    if (branches) {
      // Every WHEN spliced out as its own boolean column. The CASE alone only ever shows its
      // answer, so without these there is no way to say which branch produced it — and the first
      // true one wins, which only reads as a rule once the others can be seen failing.
      const tests = branches.branches.map((branch, index) => `(${branch.when}) as ${branchColumn(index)}`);
      queries.push({
        id: "case",
        label: "The branch each row takes",
        sql: limited(lines(`select ${[list, ...tests].join(", ")}`, fullFrom, where, groupBy, having, window)),
      });
    }
    stations.push({
      key: "select",
      id: "select",
      label: "SELECT",
      present: true,
      clause: parsed.selectClause,
      batches: [queries],
      join: null,
      joinIndex: -1,
    });
  }

  /* DISTINCT */
  const withDistinct = lines(`select ${distinct ? `${distinct} ` : ""}${list}`, fullFrom, where, groupBy, having, window);
  stations.push({
    key: "distinct",
    id: "distinct",
    label: "DISTINCT",
    present: parsed.distinct !== null,
    clause: parsed.distinct,
    batches: parsed.distinct ? [[sample(withDistinct), count(withDistinct)]] : ABSENT,
    join: null,
    joinIndex: -1,
  });

  /* ORDER BY: no count, the rows only move. */
  stations.push({
    key: "order",
    id: "order",
    label: "ORDER BY",
    present: parsed.orderBy !== null,
    clause: parsed.orderBy?.range ?? null,
    batches: parsed.orderBy ? [[sample(lines(withDistinct, orderBy))]] : ABSENT,
    join: null,
    joinIndex: -1,
  });

  /* LIMIT / OFFSET: the query exactly as written. The server still caps the rows it returns. */
  const hasLimit = parsed.limit !== null || parsed.offset !== null;
  const limitClause: Range | null =
    parsed.limit && parsed.offset
      ? { from: Math.min(parsed.limit.range.from, parsed.offset.range.from), to: Math.max(parsed.limit.range.to, parsed.offset.range.to) }
      : (parsed.limit?.range ?? parsed.offset?.range ?? null);
  stations.push({
    key: "limit",
    id: "limit",
    label: parsed.limit === null && parsed.offset !== null ? "OFFSET" : "LIMIT",
    present: hasLimit,
    clause: limitClause,
    batches: hasLimit ? [[{ id: "sample", label: "The query as written", sql: slice(parsed.statement) }]] : ABSENT,
    join: null,
    joinIndex: -1,
  });

  return stations;
}
