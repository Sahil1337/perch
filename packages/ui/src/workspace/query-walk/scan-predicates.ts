// What is INSIDE a clause body: the subquery predicates, the value lists and the conjuncts.
//
// Everything here works on a RANGE of an already-sliced statement rather than on the statement, and
// everything here reports depth-zero findings only. A predicate nested inside another is reached by
// running the same scan over that one's own clauses, which is also how a predicate two levels down
// gets its correlation worked out.

import type { Dialect } from "@perch/protocol";
import {
  bareName,
  children,
  COMPARISONS,
  countTokensIn,
  expressionAfter,
  expressionBefore,
  IDENT,
  isAnd,
  isComma,
  isSelectParens,
  parensTokens,
  spanOf,
  splitItems,
  splitOn,
  type Token,
  tokensInRange,
} from "./clause-tokens";
import type {
  InList,
  Range,
  SelectSubquery,
  SubqueryPredicate,
  SubqueryPredicateKind,
} from "./clause-types";
import { correlatedIn } from "./correlation";
import { parseTokens, scopeCtesOf } from "./parse-select";

/**
 * Every depth-zero `IN (value, value, …)` in a clause body.
 *
 * Depth zero for the same reason `subqueryPredicates` scans it: a list nested inside parentheses is
 * part of a bigger expression whose truth this cannot describe on its own. A list holding a SELECT
 * is skipped here and picked up there — the two functions partition the `IN`s between them.
 */
export function inLists(text: string, body: Range, dialect: Dialect): InList[] {
  const toks = tokensInRange(text, body, dialect, true);

  const out: InList[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    if (tok.kw !== "in") continue;
    const parens = toks[i + 1];
    if (!parens || parens.name !== "Parens") continue;
    // A subquery is the other function's business.
    if (isSelectParens(parens.node, text)) continue;
    const negated = toks[i - 1]?.kw === "not";
    const left = expressionBefore(toks, negated ? i - 1 : i);
    if (left === null) continue;

    // Split on depth-zero commas. A comma INSIDE a value — `in (point(1, 2))` — is a child of that
    // value's own node and never a direct child here, so the split cannot cut a value in half.
    const values = splitOn(parensTokens(parens.node, text), isComma)
      .map(spanOf)
      .filter((value): value is Range => value !== null);
    if (values.length === 0) continue;

    out.push({
      // `x not in (1, 2)` starts at `x`: the left expression is part of the predicate as written.
      range: { from: left.from, to: parens.to },
      left,
      values,
      negated,
      hasNull: values.some(
        (value) => text.slice(value.from, value.to).trim().toLowerCase() === "null",
      ),
    });
    i += 1;
  }
  return out;
}

/**
 * The depth-zero subquery predicates in a clause body, in source order. Nested ones are reachable
 * by running this again over each predicate's own `parsed` clauses, which is also how a predicate
 * two levels down gets its own correlation worked out.
 */
export function subqueryPredicates(
  text: string,
  body: Range,
  dialect: Dialect,
): SubqueryPredicate[] {
  const toks = tokensInRange(text, body, dialect, true);

  const scopeCtes = scopeCtesOf(text, dialect);

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
    out.push({
      kind,
      range,
      body: inner,
      left,
      operator,
      parsed,
      correlated: correlatedIn(parens.node, text, parsed, scopeCtes),
    });
  };

  let i = 0;
  while (i < toks.length) {
    const tok = toks[i]!;
    const next = toks[i + 1];
    const prev = toks[i - 1];
    const negated = prev?.kw === "not";

    if (tok.kw === "exists" && next?.name === "Parens" && isSelectParens(next.node, text)) {
      build(
        negated ? "not exists" : "exists",
        { from: (negated ? prev! : tok).from, to: next.to },
        next,
        null,
        null,
      );
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
  const toks = tokensInRange(text, list, dialect, false);

  const scopeCtes = scopeCtesOf(text, dialect);

  const out: SelectSubquery[] = [];
  for (const item of splitItems(toks)) {
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
  const toks = tokensInRange(text, body, dialect, true);
  if (toks.some((token) => token.kw === "or")) return [body];
  const out = splitOn(toks, isAnd)
    .map(spanOf)
    .filter((range): range is Range => range !== null);
  return out.length === 0 ? [body] : out;
}
