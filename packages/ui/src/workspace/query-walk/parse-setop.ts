// A depth-zero UNION / INTERSECT / EXCEPT chain, split into the branches it joins.
//
// A chain is not a SELECT and `parseTokens` refuses one outright, which is what makes this a
// separate reading of the same tokens rather than a case inside that one. Each branch, once cut
// out, IS an ordinary SELECT and goes straight back through `parseTokens`.

import type { Dialect } from "@perch/protocol";
import {
  isSelectParens,
  isTailStart,
  kwAt,
  parensTokens,
  statementTokens,
  type SyntaxNode,
  type Token,
  TokenCursor,
} from "./clause-tokens";
import type {
  Cte,
  ParsedSelect,
  ParsedSetOp,
  Range,
  SetBranch,
  SetOperator,
  SetTree,
  Unsupported,
} from "./clause-types";
import { parseTokens, readTail, readWith } from "./parse-select";

/**
 * Binding strength, and the only thing that differs between the operators.
 *
 * INTERSECT binds tighter than UNION and EXCEPT in both dialects the walk parses. `ALL` changes
 * whether duplicates survive, never how tightly the operator binds, so the two spellings of each
 * operator share a number.
 */
const SET_PRECEDENCE: Record<SetOperator, number> = {
  intersect: 2,
  "intersect all": 2,
  union: 1,
  "union all": 1,
  except: 1,
  "except all": 1,
};

/**
 * The flat chain, grouped the way it evaluates.
 *
 * Two levels and left association are the whole grammar, so this is two loops rather than a general
 * precedence climb: the inner one takes every INTERSECT it can reach, the outer one folds what is
 * left. The cursor is both "next branch to take" and "index of the operator that follows what has
 * been taken so far" — those stay equal because branches and operators alternate, and it is why one
 * counter is enough for both.
 */
function setTree(ops: readonly SetOperator[]): SetTree {
  let i = 0;
  const tighter = (): SetTree => {
    let node: SetTree = { kind: "branch", index: i };
    while (i < ops.length && SET_PRECEDENCE[ops[i]!] === 2) {
      const opIndex = i;
      i += 1;
      node = {
        kind: "combine",
        op: ops[opIndex]!,
        opIndex,
        left: node,
        right: { kind: "branch", index: i },
      };
    }
    return node;
  };
  let node = tighter();
  while (i < ops.length) {
    const opIndex = i;
    i += 1;
    node = { kind: "combine", op: ops[opIndex]!, opIndex, left: node, right: tighter() };
  }
  return node;
}

/** Whether the chain groups any other way than plain left to right, which is the only case a
 *  reader has to be told about: when it does not, the written order IS the evaluation order. */
export function regroups(parsed: ParsedSetOp): boolean {
  const leftToRight = (node: SetTree): boolean =>
    node.kind === "branch"
      ? node.index === 0
      : node.right.kind === "branch" && leftToRight(node.left);
  return !leftToRight(parsed.tree);
}

/**
 * The statement, whichever of the two shapes it has. A depth-zero UNION / INTERSECT / EXCEPT makes
 * it a `ParsedSetOp`; anything else is handed to `parseSelect` unchanged.
 */
export function parseStatement(
  text: string,
  dialect: Dialect,
): ParsedSelect | ParsedSetOp | Unsupported {
  const toks = statementTokens(text, dialect);
  if (!toks) return { kind: "unsupported", reason: "There is no statement to walk." };

  // The WITH prefix is read first so its `x as (select … union …)` parentheses — which are one
  // Parens token and therefore invisible at depth zero anyway — are never mistaken for the
  // statement's own chain, and so the branch scan starts at the first branch.
  const cur = new TokenCursor(toks, text);
  const prefix = readWith(cur);
  const operators: { op: SetOperator; range: Range; before: number; after: number }[] = [];
  for (let i = cur.index; i < toks.length; i++) {
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
  const tail = readTail(new TokenCursor(toks, text, tailStart));

  const bounds: { from: number; to: number }[] = [];
  let start = cur.index;
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
        range: {
          from: toks[Math.min(from, toks.length - 1)]!.from,
          to: toks[Math.min(from, toks.length - 1)]!.from,
        },
        parsed: { kind: "unsupported", reason: "This branch of the set operation is empty." },
      };
    }
    // `(select …) union (select …)`: the branch's own range keeps the parentheses, because that is
    // what the user wrote and what gets highlighted, but the parse — and so any probe spliced from
    // it — works on the body, where the branch's own ORDER BY and LIMIT legitimately live.
    const inner = unwrapBranch(run, text);
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
    tree: setTree(operators.map(({ op }) => op)),
    orderBy: tail.orderBy,
    orderItems: tail.orderItems,
    limit: tail.limit,
    limitValue: tail.limitValue,
    offset: tail.offset,
    offsetValue: tail.offsetValue,
  };
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
    return {
      op: `${base} all` as SetOperator,
      range: { from: tok.from, to: toks[index + 1]!.to },
      next: index + 2,
    };
  }
  // DISTINCT is the default, so it changes the range the UI highlights but not the operator.
  if (modifier === "distinct") {
    return { op: base, range: { from: tok.from, to: toks[index + 1]!.to }, next: index + 2 };
  }
  return { op: base, range: { from: tok.from, to: tok.to }, next: index + 1 };
}

/**
 * The branches of a set-operation body, parsed over the SAME text the caller is scanning.
 *
 * `parseStatement` would also produce branches, but only by re-parsing a SLICE, and every range it
 * returned would then index that slice instead of this text — which is useless to a scan that works
 * in the enclosing statement's coordinates. Splitting the token run here keeps one coordinate
 * space, and reuses the same operator reader the statement-level split does.
 */
export function setOpBranchParses(
  parens: SyntaxNode,
  text: string,
  scopeCtes: readonly Cte[],
): ParsedSelect[] {
  const toks = parensTokens(parens, text);
  const bounds: { from: number; to: number }[] = [];
  let start = 0;
  for (let i = 0; i < toks.length; i++) {
    const op = readSetOperator(toks, i);
    if (!op) continue;
    bounds.push({ from: start, to: i });
    start = op.next;
    i = op.next - 1;
  }
  if (bounds.length === 0) return [];
  bounds.push({ from: start, to: toks.length });

  const out: ParsedSelect[] = [];
  for (const bound of bounds) {
    const run = toks.slice(bound.from, bound.to);
    const head = run[0];
    if (!head) continue;
    const inner = unwrapBranch(run, text);
    const parsed = parseTokens(text, inner, scopeCtes);
    if (parsed.kind === "select") out.push(parsed);
  }
  return out;
}

/**
 * A branch written `(select …)`, read as the SELECT inside it.
 *
 * The branch's own range keeps the parentheses, because that is what the user wrote and what gets
 * highlighted — but the parse, and so any probe spliced from it, works on the body, where the
 * branch's own ORDER BY and LIMIT legitimately live.
 */
function unwrapBranch(run: readonly Token[], text: string): readonly Token[] {
  const head = run[0];
  return run.length === 1 && head && head.name === "Parens" && isSelectParens(head.node, text)
    ? parensTokens(head.node, text)
    : run;
}
