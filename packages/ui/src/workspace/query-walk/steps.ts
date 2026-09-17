// From the sliced clauses to the ordered stations, each with the SQL it samples and counts.
//
// Every query is the user's own text spliced together, so the "SQL that ran" block can show it and
// it means what the user wrote. A newline goes before anything appended: a `-- comment` at the end
// of a clause would otherwise swallow the `limit` that follows it.

import type { Dialect } from "@perch/protocol";
import {
  bareName,
  conjuncts,
  regroups,
  type InList,
  inLists,
  type JoinClause,
  type ParsedSelect,
  type ParsedSetOp,
  type Range,
  type SetOperator,
  type SetTree,
  type SourceRef,
  WALK_PREFIX,
} from "./clauses";
// Type-only, and deliberately so: `program.ts` reaches `grid.ts`, which reaches back here, and an
// import that survived to runtime would close that ring. What the walk needs from a `Recursion` is
// its shape, which costs nothing at run time.
import type { Recursion } from "./program";

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
  | "limit"
  /** The whole of a section that has no clause sequence: see `buildResultStation`. */
  | "result"
  /** One meeting of two results in a set-operator chain: see `buildSetStations`. */
  | "combine";

/** Rows a sample asks for. The server caps at the same number through `maxRows`. */
export const SAMPLE_ROWS = 25;

/** Output columns the walk adds for its own bookkeeping; never shown. */
export const PASS_COLUMN = `${WALK_PREFIX}pass`;
export const keyColumn = (index: number): string => `${WALK_PREFIX}k${index}`;
/** The match count a per-row probe carries back for each outer row. */
export const MATCH_COLUMN = `${WALK_PREFIX}n`;
/** One correlated reference's value on the outer row, under a name the walk owns. */
export const bindColumn = (index: number): string => `${WALK_PREFIX}v${index}`;
/**
 * The outer row's value for the expression a predicate compares — `s.dept_name` in
 * `s.dept_name in (select …)`.
 *
 * It rides on the outer probe that already runs rather than costing a statement of its own, and it
 * is what lets an IN light the matching value in the list and a scalar show its equation. EXISTS
 * has no such expression and the probe simply does not ask for one.
 */
export const LEFT_COLUMN = `${WALK_PREFIX}left`;
/** One depth-zero conjunct of a WHERE, evaluated per row: how far from passing a failing row was. */
export const conjunctColumn = (index: number): string => `${WALK_PREFIX}c${index}`;
/**
 * One value of an `IN (…)` list tested against the row: did THIS row match THIS value.
 *
 * The database answers it, never the walk. Comparing the row's value to the literal in JavaScript
 * would mean re-deciding collation, numeric coercion and `CHAR` padding, and would differ from the
 * query's own verdict in precisely the cases nobody checks.
 */
export const memberColumn = (list: number, value: number): string =>
  `${WALK_PREFIX}m${list}_${value}`;
/** Whether the compared expression was itself null, which is why a row matched nothing. */
export const memberNullColumn = (list: number): string => `${WALK_PREFIX}mn${list}`;

/**
 * Caps on the membership columns one WHERE probe may grow.
 *
 * A long `IN` list is a lookup table pasted into a query, not a lesson: past a dozen values the
 * card cannot show them and the reader was never reading them one by one. Lists past the cap keep
 * the ordinary pass/fail they have today rather than a partial answer, which would be the worse
 * of the two — a row reported as matching nothing when the value it matched was simply not asked
 * about.
 */
export const MAX_IN_VALUES = 12;
const MAX_IN_LISTS = 3;

/**
 * Every `IN` list of a WHERE, each saying whether it was small enough to measure.
 *
 * The unmeasured ones are carried rather than dropped so the scene can SAY that a list is being
 * shown as one plain pass/fail — a reader who got a matched column on one list and nothing on the
 * next would otherwise read the gap as a bug rather than as a cap.
 */
export function measurableInLists(
  parsed: ParsedSelect,
  dialect: Dialect,
): { readonly list: InList; readonly index: number; readonly measured: boolean }[] {
  if (!parsed.where) return [];
  return inLists(parsed.text, parsed.where.body, dialect).map((list, index) => ({
    list,
    index,
    measured: list.values.length <= MAX_IN_VALUES && index < MAX_IN_LISTS,
  }));
}
/**
 * The two names the grid probe adds on top of those.
 *
 * They live here beside the others rather than next to the grid builder so that `bound.ts` and
 * `grid.ts` can both read a probe's columns back without either importing the other — the cycle
 * that would otherwise run program → grid → bound → program.
 */
export const CELL_COLUMN = `${WALK_PREFIX}cell`;
/** One driving row's key on the grid's column axis: `rc.course_id`. */
export const driveColumn = (index: number): string => `${WALK_PREFIX}g${index}`;
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
  /**
   * A sentence that overrides the narrator's own, for a station the clause vocabulary cannot
   * describe.
   *
   * Null for every station named after a clause: FROM, WHERE and the rest are explained from the
   * parse, which is richer than anything a builder could write down in advance. It is set where
   * there is no clause to explain — a recursive CTE's three stations are about the shape of the
   * whole CTE, and `sentenceFor` has nothing to read that would tell it so.
   */
  readonly sentence: string | null;
  /**
   * A range in the ROOT text this station is about, when `clause` does not index the section's text.
   *
   * The two are alternatives, not a pair. `clause` is an offset into the statement the section runs,
   * which for most sections IS the reader's text shifted by a prefix; for a section whose text the
   * walk invented there is no such offset, and the honest thing to point at is the root range the
   * program mapped when it took the section apart. Null when neither is available.
   */
  readonly root: Range | null;
  /**
   * The `IN (value, …)` lists this station measured, with the index each one's probe columns carry.
   *
   * Carried rather than recomputed: the scene would otherwise have to re-parse the clause to learn
   * which column belongs to which value, and it would need the dialect threaded down to it to do
   * that. Empty for every station but WHERE, and for a WHERE whose lists were all too long.
   */
  readonly inLists: readonly {
    readonly list: InList;
    readonly index: number;
    readonly measured: boolean;
  }[];
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

/**
 * The whole walk for a section that produces a table but has no clauses to step through: one
 * station, which runs the statement and counts it.
 *
 * `text` is spliced in exactly as it stands, prefix and all, and NOTHING is appended to it — the
 * same rule the LIMIT station follows for the same reason. A `VALUES` list or a `select 1` may
 * carry a LIMIT of its own, and gluing a second one on the end would turn a query that runs into a
 * syntax error; the row cap the server applies through `maxRows` does the job either way.
 *
 * The count wraps the statement in a derived table, which is legal around a WITH prefix in both
 * dialects the walk speaks, so a CTE list in scope rides along untouched.
 */
export function buildResultStation(text: string): Station {
  return {
    key: "result",
    id: "result",
    label: "RESULT",
    present: true,
    clause: { from: 0, to: text.length },
    batches: [
      [
        { id: "sample", label: "The query as written", sql: text },
        {
          id: "count",
          label: "Count",
          sql: `select count(*) from (\n${text}\n) as ${WALK_PREFIX}count`,
        },
      ],
    ],
    join: null,
    joinIndex: -1,
    sentence: null,
    root: null,
    inLists: [],
  };
}

/**
 * One station per meeting of two results in a set-operator chain.
 *
 * WHY THIS IS NOT A PLACEHOLDER ANY MORE. A combine has no clauses, so the station rail's usual
 * vocabulary says nothing about it — but "which rows survived, and from which side" is a question
 * with an exact answer, and the database can be asked it directly. What made it look unanswerable
 * was that the obvious way to answer it is wrong: the branches' own cards hold 25 sampled rows
 * each, and deciding membership by comparing those two samples would report a row as dropped by an
 * INTERSECT whenever its partner happened to fall outside the other sample. That is a confident
 * lie of exactly the kind this screen exists not to tell. So nothing is compared here. Every
 * bucket below is a set operation the DATABASE evaluates over the full branches.
 *
 * THE THREE BUCKETS. `L INTERSECT R`, `L EXCEPT R` and `R EXCEPT L` partition the distinct rows of
 * the two sides, and between them they explain every operator: UNION keeps all three, INTERSECT
 * keeps the middle one, EXCEPT keeps the first. The picture is a Venn diagram whose regions were
 * each computed rather than inferred, and the only words the walk writes are the operator names.
 *
 * WHY `ALL` GETS NO BUCKETS. The partition is about DISTINCT rows. `UNION ALL` keeps duplicates, so
 * its answer can be longer than the three buckets put together, and drawing them beside it would
 * misdescribe the very thing that makes `ALL` different. Those stations show the two inputs and the
 * real result, and say why the regions are missing.
 *
 * Each subtree is a CONTIGUOUS run of branches, and its verbatim text re-parses to the same
 * grouping, because that grouping came from precedence in the first place — which is what lets a
 * node's SQL be a slice of the user's statement rather than something reassembled.
 */
export function buildSetStations(parsed: ParsedSetOp): Station[] {
  const withPrefix = parsed.with
    ? `${parsed.text.slice(parsed.with.from, parsed.with.to)}\n`
    : "";
  // The branches a subtree spans. Contiguity is the invariant the slice below depends on.
  const span = (node: SetTree): { min: number; max: number } => {
    if (node.kind === "branch") return { min: node.index, max: node.index };
    const left = span(node.left);
    const right = span(node.right);
    return { min: Math.min(left.min, right.min), max: Math.max(left.max, right.max) };
  };
  const sqlOf = (node: SetTree): string => {
    const { min, max } = span(node);
    const from = parsed.branches[min]!.range.from;
    const to = parsed.branches[max]!.range.to;
    return parsed.text.slice(from, to);
  };
  /** A subtree as an operand: parenthesised, so a branch's own ORDER BY or LIMIT stays inside it. */
  const operand = (node: SetTree): string => `(\n${sqlOf(node)}\n)`;
  const limited = (sql: string): string => `${withPrefix}${sql}\nlimit ${SAMPLE_ROWS}`;
  const counted = (sql: string): string =>
    `${withPrefix}select count(*) from (\n${sql}\n) as ${WALK_PREFIX}count`;
  const pair = (id: string, label: string, sql: string): Query[] => [
    { id: `${id}.sample`, label, sql: limited(sql) },
    { id: `${id}.count`, label: `${label} — count`, sql: counted(sql) },
  ];

  const nodes: Extract<SetTree, { kind: "combine" }>[] = [];
  // Post-order, so the chapter plays in the order the database evaluates: the tightest-binding
  // meeting first, and each later station's inputs are ones the reader has already been shown.
  const collect = (node: SetTree): void => {
    if (node.kind === "branch") return;
    collect(node.left);
    collect(node.right);
    nodes.push(node);
  };
  collect(parsed.tree);

  const repeated = new Set<string>();
  const seen = new Set<string>();
  for (const node of nodes) {
    const word = node.op.toUpperCase();
    if (seen.has(word)) repeated.add(word);
    seen.add(word);
  }
  const ordinal = new Map<string, number>();

  return nodes.map((node) => {
    const word = node.op.toUpperCase();
    const next = (ordinal.get(word) ?? 0) + 1;
    ordinal.set(word, next);
    const left = operand(node.left);
    const right = operand(node.right);
    const result = `${left}\n${node.op}\n${right}`;
    const keepsDuplicates = node.op.endsWith(" all");

    // Two batches on purpose. The first is the chapter: the inputs and the answer, and it must not
    // be lost to a dialect that cannot evaluate the second. The second is the Venn regions, which
    // need INTERSECT and EXCEPT — MySQL only learned them in 8.0.31 — so when they fail they fail
    // alone and the scene says the regions are unavailable rather than showing them empty.
    const batches: Query[][] = [
      [
        ...pair("left", "The left-hand result", sqlOf(node.left)),
        ...pair("right", "The right-hand result", sqlOf(node.right)),
        { id: "sample", label: `After ${word}`, sql: limited(result) },
        { id: "count", label: "Count", sql: counted(result) },
      ],
    ];
    if (!keepsDuplicates) {
      // One region of every INTERSECT and EXCEPT is the operator's own answer — `L intersect R` IS
      // the middle region, `L except R` IS the left one — so asking for it again would send the
      // same statement to the user's database twice per station. The region is dropped here and
      // the scene reads it off `sample`, which also means it survives a dialect that cannot
      // evaluate the rest of this batch.
      const same = node.op.startsWith("intersect") ? "both" : node.op.startsWith("except") ? "onlyLeft" : null;
      batches.push([
        ...(same === "both" ? [] : pair("both", "In both", `${left}\nintersect\n${right}`)),
        ...(same === "onlyLeft" ? [] : pair("onlyLeft", "Only on the left", `${left}\nexcept\n${right}`)),
        ...pair("onlyRight", "Only on the right", `${right}\nexcept\n${left}`),
      ]);
    }

    return {
      key: `combine${node.opIndex}`,
      id: "combine" as const,
      label: repeated.has(word) ? `${word} ${next}` : word,
      present: true,
      clause: parsed.operators[node.opIndex]?.range ?? null,
      batches,
      join: null,
      joinIndex: -1,
      // A chain that regroups owes the reader one more sentence, and only on the station that DOES
      // the regrouping: these two results met first because this operator binds tighter, not
      // because they were written next to each other.
      sentence: combineSentence(
        node.op,
        keepsDuplicates,
        regroups(parsed) && node.op.startsWith("intersect"),
      ),
      root: null,
      inLists: [],
    };
  });
}

/** What the operator does to the two results, in the reader's terms. */
function combineSentence(op: SetOperator, keepsDuplicates: boolean, tighter: boolean): string {
  const base =
    op.startsWith("union")
      ? "keeps every row that appeared on either side"
      : op.startsWith("intersect")
        ? "keeps only the rows that appeared on BOTH sides"
        : "keeps the rows from the left that did NOT appear on the right";
  const duplicates = keepsDuplicates
    ? " ALL keeps duplicates, so a row that appeared twice still appears twice — which is why the regions below are not drawn for it."
    : " Duplicates collapse: the result is a set, so a row that appeared on both sides appears once.";
  const binding = tighter
    ? " These two met before the rest of the chain because INTERSECT binds tighter than UNION and EXCEPT — not because they were written side by side."
    : "";
  return `This step ${base}.${duplicates}${binding}`;
}

/**
 * The three stations a recursive CTE gets once `program.ts` has proved its shape: START, REPEAT,
 * SETTLE.
 *
 * All three are `id: "result"` — a rows card and a count, the same one `buildResultStation` gets —
 * because what they teach is the DIFFERENCE between three tables, not anything happening inside one
 * of them. A scene of their own would have to animate a loop the walk deliberately does not run.
 *
 * REPEAT is the only one that rewrites anything, and what it does is the rewrite the database does
 * on its first pass: `chain c` becomes `(<the anchor>) c`. It is spliced BY RANGE, right to left,
 * off the ranges `readRecursion` recorded — a string replace of the name would also hit the `chain`
 * in a column called `chain_id`, in a quoted identifier, or in a literal, and the statement it built
 * would run and be wrong rather than fail.
 *
 * `prefix` is the whole WITH list this section runs with, the recursive CTE included, and it is
 * rendered ONCE at the head of each statement. Three things follow from that. The anchor spliced
 * into REPEAT carries no prefix of its own, because a WITH inside a derived table is not legal
 * there. The count wrapper keeps the prefix outside its subquery, for the same reason. And the CTE
 * sitting unreferenced in START's and REPEAT's prefix costs nothing: an unreferenced CTE is not
 * executed, recursive or not, so neither statement ever runs the recursion it is explaining.
 */
export function buildRecursionStations(
  recursion: Recursion,
  prefix: string,
  cteName: string,
  wholeText: string,
): Station[] {
  // Nothing is appended to any of these, so the newline rule at the top of the file applies only
  // where the wrapper puts a body on its own line — which it does, for exactly that reason.
  const counted = (body: string): string =>
    `${prefix}select count(*) from (\n${body}\n) as ${WALK_PREFIX}count`;
  const station = (
    key: string,
    label: string,
    sampleLabel: string,
    body: string,
    sample: string,
    sentence: string,
    root: Range | null,
  ): Station => ({
    key,
    id: "result",
    label,
    present: true,
    // The statement these run is not the section's own text, so an offset into it would index
    // nothing the narrator could point at. `root` carries the reader's line instead.
    clause: null,
    batches: [
      [
        { id: "sample", label: sampleLabel, sql: sample },
        { id: "count", label: "Count", sql: counted(body) },
      ],
    ],
    join: null,
    joinIndex: -1,
    sentence,
    root,
    inLists: [],
  });

  const settleBody = `select * from ${cteName}`;
  const pass = firstPass(recursion);
  return [
    station(
      "recursion.start",
      "START",
      "Where the recursion begins",
      recursion.anchorSql,
      `${prefix}${recursion.anchorSql}`,
      recursion.sentences.start,
      recursion.anchor,
    ),
    station(
      "recursion.repeat",
      "REPEAT",
      "One pass of the step",
      pass,
      `${prefix}${pass}`,
      recursion.sentences.repeat,
      recursion.step,
    ),
    station(
      "recursion.settle",
      "SETTLE",
      "The whole CTE, every pass run",
      settleBody,
      wholeText,
      recursion.sentences.settle,
      recursion.anchor === null || recursion.step === null
        ? null
        : { from: recursion.anchor.from, to: recursion.step.to },
    ),
  ];
}

/**
 * The recursive term with the anchor standing in for the CTE: what the database computes on its
 * first pass, and the only pass the walk can show without iterating.
 *
 * The alias is kept as the reader wrote it — `chain c` becomes `(…) c` — because the rest of the
 * term is full of `c.id` and a derived table under any other name would not resolve them. Where
 * they wrote no alias the CTE's own name takes its place, which is what they were already using.
 */
function firstPass(recursion: Recursion): string {
  let out = recursion.stepSql;
  for (const ref of [...recursion.selfRefs].sort((a, b) => b.range.from - a.range.from)) {
    out = `${out.slice(0, ref.range.from)}(${recursion.anchorSql}) ${ref.alias}${out.slice(ref.range.to)}`;
  }
  return out;
}

export function buildStations(parsed: ParsedSelect, dialect: Dialect): Station[] {
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
    sentence: null,
    root: null,
    inLists: [],
  });

  /* JOIN n: the FROM list up to and including join n. */
  if (parsed.joins.length === 0) {
    stations.push({ key: "join", id: "join", label: "JOIN", present: false, clause: null, batches: ABSENT, join: null, joinIndex: -1, sentence: null, root: null, inLists: [] });
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
      sentence: null,
      root: null,
      inLists: [],
    });
  });

  /* WHERE */
  {
    const base = lines("select *", fullFrom, where);
    // One boolean per depth-zero conjunct, beside the verdict the station already asks for. It is
    // the same statement with wider columns, not a second probe, and it is the only measure of
    // "how close did this row come" that exists for free: a row that failed one of three tests got
    // further than a row that failed all three. A single-conjunct WHERE adds nothing, because the
    // one column would be the verdict again under another name.
    const parts = parsed.where ? conjuncts(text, parsed.where.body, dialect) : [];
    const tests = parts.length > 1 ? parts.map((part, index) => `, (${slice(part)}) as ${conjunctColumn(index)}`) : [];
    // One boolean per value of each `IN (…)` list, on the same widened statement. `x in (a, b)` is
    // one verdict but three facts, and the two that the pass/fail throws away — WHICH value matched,
    // and whether the left side was null and so matched nothing it could have — are the two the
    // predicate is actually about. The null test is asked separately because `x = a` is null rather
    // than false when `x` is, so the value columns alone cannot tell "matched nothing" from "had
    // nothing to match with".
    const lists = measurableInLists(parsed, dialect);
    const members = lists.filter((entry) => entry.measured).flatMap(({ list, index }) => [
      ...list.values.map(
        (value, vi) => `, ((${slice(list.left)}) = (${slice(value)})) as ${memberColumn(index, vi)}`,
      ),
      `, ((${slice(list.left)}) is null) as ${memberNullColumn(index)}`,
    ]);
    const queries: Query[] = parsed.where
      ? [
          sample(base),
          count(base),
          {
            id: "verdict",
            label: "Row test",
            sql: limited(
              lines(
                `select *, (${slice(parsed.where.body)}) as ${PASS_COLUMN}${tests.join("")}${members.join("")}`,
                fullFrom,
              ),
            ),
          },
        ]
      : [];
    stations.push({ key: "where", id: "where", label: "WHERE", present: parsed.where !== null, clause: parsed.where?.range ?? null, batches: parsed.where ? [queries] : ABSENT, join: null, joinIndex: -1, sentence: null, root: null, inLists: parsed.where ? lists : [] });
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
    stations.push({ key: "group", id: "group", label: "GROUP BY", present: parsed.groupBy !== null, clause: parsed.groupBy?.range ?? null, batches: parsed.groupBy ? [queries] : ABSENT, join: null, joinIndex: -1, sentence: null, root: null, inLists: [] });
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
    stations.push({ key: "having", id: "having", label: "HAVING", present: parsed.having !== null, clause: parsed.having?.range ?? null, batches: parsed.having ? [queries] : ABSENT, join: null, joinIndex: -1, sentence: null, root: null, inLists: [] });
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
      sentence: null,
      root: null,
      inLists: [],
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
      sentence: null,
      root: null,
      inLists: [],
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
    sentence: null,
    root: null,
    inLists: [],
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
    sentence: null,
    root: null,
    inLists: [],
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
    sentence: null,
    root: null,
    inLists: [],
  });

  return stations;
}
