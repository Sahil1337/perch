// One sentence per station, naming the real tables, keys and columns from the user's query, and
// the phases each station plays through.

import type { BoundPlan, BoundRow } from "./bound";
import type { JoinClause, SubqueryPredicateKind } from "./clauses";
import { cellFound, isNegativeKind, type GridBuild } from "./grid";
import { previousIndex, sampleId, type AnswerView } from "./scenes";
import { caseExpressions, sourceTitle, WALK_PREFIX, type WindowFn, windowFunctions } from "./steps";
import type { StationState, WalkData } from "./use-walk";

export type Phase = { readonly ms: number; readonly label: string };

/** Gap between one row's test and the next, in WHERE and HAVING. */
export const STAGGER_MS = 110;
/** Rest on a station's settled state before playback moves on. */
export const HOLD_MS = 1000;

const code = (text: string): string => `\`${text.replace(/\s+/g, " ").trim()}\``;

function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** `dept_name` and `dept_name and year`: the partition, named the way the user wrote it. */
function paneKeys(fn: WindowFn): string {
  return fn.partition.map(code).join(" and ");
}

function joinCondition(join: JoinClause): string {
  if (join.using) return `${code(`using (${join.keys.map((pair) => pair.left).join(", ")})`)} matches`;
  if (join.keys.length === 0) return "the ON condition holds";
  return join.keys.map((pair) => code(`${pair.left} = ${pair.right}`)).join(" and ");
}

/**
 * What a section with no clause sequence IS, and why it gets one card instead of ten stations.
 *
 * Three different things land here and they teach three different lessons, so they do not share a
 * line. Saying "this could not be walked" to all of them would be the old bug wearing a sentence:
 * none of them failed, and each one has a reason of its own for having no clauses to walk.
 */
function resultSentence(walk: WalkData): string {
  const sql = code(walk.result?.body ?? walk.text);
  switch (walk.result?.kind) {
    case "values":
      return `${sql} is a table written out by hand. Its rows are not read from anywhere — they are spelled in the query itself, which is why there is no FROM to start from and no WHERE to narrow. That is the whole step: the rows below exist the moment the statement runs, and whatever reads this section reads them like any other table's.`;
    case "no-from":
      return `${sql} has no FROM, so there is no table for the clause order to act on. SELECT computes its expressions once and hands back exactly one row, and the stations this walk usually steps through — narrowing, gathering, sorting — all exist to do something to rows that are already there. With none to start from there is nothing for them to do, which is not a failure: it is what a SELECT without a FROM means.`;
    case "writes":
      return `${sql} changes the database rather than reading it, so the walk shows it and never runs it.`;
    default:
      return `${sql} produces a table but has no clauses to step through, so it is shown exactly as it was written.`;
  }
}

export function sentenceFor(index: number, walk: WalkData): string {
  const { parsed, stations } = walk;
  const station = stations[index]!;
  if (station.id === "result") return resultSentence(walk);
  // Every station below reads clauses off the parse, and the only walk without one is the
  // result-only walk the line above has already answered for.
  if (parsed === null) return "";
  const text = (from: number, to: number): string => parsed.text.slice(from, to);
  const sources = [parsed.first, ...parsed.joins.map((join) => join.source)];

  switch (station.id) {
    case "from": {
      const named = sources.some((source) => source.kind !== "table");
      return named
        ? "Start with the raw tables. A subquery or CTE is a table too: it is computed first, then read like any other."
        : "Start with the raw tables. Nothing has been filtered yet.";
    }
    case "join": {
      const join = station.join;
      if (!join) return "Not in this query. A join would pair these rows with another table's.";
      const left = station.joinIndex === 0 ? code(sourceTitle(parsed.first)) : "the rows so far";
      const right = code(sourceTitle(join.source));
      if (join.kind === "cross") {
        return `Pair every row of ${left} with every row of ${right}. There is no condition, so the result is one row per combination.`;
      }
      const pair = `Pair each row of ${left} with its match in ${right} where ${joinCondition(join)}.`;
      switch (join.kind) {
        case "left":
          return `${pair} With a left join a row with no match is kept, and its ${right} columns are null.`;
        case "right":
          return `${pair} With a right join a row of ${right} with no match is kept, and the other columns are null.`;
        case "full":
          return `${pair} With a full join rows with no match on either side are kept, padded with nulls.`;
        default:
          return `${pair} A row with no match is dropped, because this is an inner join.`;
      }
    }
    case "where":
      return parsed.where
        ? `Test every row against ${code(text(parsed.where.body.from, parsed.where.body.to))}. Rows that fail are thrown away.`
        : "Not in this query. Every row gets through.";
    case "group": {
      if (!parsed.groupBy) return "Not in this query. Each row stays its own row.";
      const keys = parsed.groupKeys.map(code).join(" and ");
      return `Rows with the same ${keys} are gathered into one group. Each group will become one row.`;
    }
    case "having":
      return parsed.having
        ? `Like WHERE, but for groups. Groups that fail ${code(text(parsed.having.body.from, parsed.having.body.to))} are thrown away.`
        : "Not in this query. It would filter groups the way WHERE filters rows.";
    case "window": {
      const functions = windowFunctions(parsed);
      const fn = functions[0];
      if (!fn) {
        return "Not in this query. A window function would give every row a value read off the rows around it, without losing a single one of them.";
      }
      const partitioned = fn.partition.length > 0;
      const panes = partitioned
        ? `${code(fn.call)} cuts the rows into one pane per ${paneKeys(fn)}`
        : `With nothing to partition by, ${code(fn.call)} takes the whole result as a single pane`;
      const walked =
        fn.order.length > 0
          ? `, walks ${partitioned ? "each pane" : "it"} in ${fn.order.map(code).join(", ")} order,`
          : "";
      const others = functions.length - 1;
      const rest =
        others > 0
          ? ` The other ${others === 1 ? "window function runs" : `${others} window functions run`} here too, each with its own panes.`
          : "";
      return `${panes}${walked} and hands every row its own value. Unlike GROUP BY it collapses nothing: the rows are all still here, which is why ORDER BY can sort by what it computed and WHERE, long finished, never saw it.${rest}`;
    }
    case "select": {
      const alias = firstAlias(index, walk);
      const base = alias
        ? `Only now are the output columns chosen and computed. Aliases like ${code(alias)} are born here, which is why WHERE could not use them and ORDER BY can.`
        : "Only now are the output columns chosen and computed. Nothing earlier could refer to a column that does not exist yet, which is why WHERE runs before SELECT.";
      const branches = caseExpressions(parsed)[0];
      if (!branches) return base;
      const fallback = branches.fallback
        ? `falls through to ${code(branches.fallback)}`
        : `comes out null, because this ${code("case")} has no ${code("else")}`;
      return `${base} The ${code("case")} is one of those columns: each row takes the first ${code("when")} that is true of it, and a row no branch claims ${fallback}.`;
    }
    case "distinct":
      return station.present
        ? "Identical rows are merged into one."
        : "Not in this query. It would merge identical rows.";
    case "order": {
      if (!station.present) {
        return "Not in this query. Without it the rows come back in whatever order the database found them.";
      }
      const items = parsed.orderItems
        .map((item) => code(`${item.expr}${item.desc ? " DESC" : ""}`))
        .join(", ");
      const first = parsed.orderItems[0];
      const meaning = first
        ? first.desc
          ? "`DESC` means biggest first."
          : "Ascending, so smallest first."
        : "";
      return `Sort the rows by ${items}. ${meaning}`.trim();
    }
    case "limit": {
      if (!station.present) return "Not in this query. Every row that survived comes back.";
      const { limitValue, offsetValue } = parsed;
      if (limitValue !== null && offsetValue !== null) {
        return `Skip the first ${offsetValue}, keep the next ${limitValue} and drop the rest.`;
      }
      if (limitValue !== null) return `Keep the first ${limitValue} and drop the rest.`;
      if (offsetValue !== null) return `Skip the first ${offsetValue} and keep the rest.`;
      return "Keep only the rows the LIMIT allows and drop the rest.";
    }
  }
}

/** An output column name that no earlier column had: born in SELECT. */
function firstAlias(index: number, walk: WalkData): string | null {
  const station = walk.stations[index]!;
  const output = walk.results[index]?.queries[sampleId(station)];
  const previous = previousIndex(walk, index);
  if (!output?.ok || previous === null) return null;
  const earlier = walk.results[previous]?.queries[sampleId(walk.stations[previous]!)];
  if (!earlier?.ok) return null;
  const known = new Set(earlier.result.columns.map((column) => column.name.toLowerCase()));
  const fresh = output.result.columns.find(
    (column) => !known.has(column.name.toLowerCase()) && !column.name.startsWith(WALK_PREFIX),
  );
  return fresh?.name ?? null;
}

/** Each phase of a station: how long it holds before the next (ms, at 1x) and a short label. */
export function phasesFor(index: number, walk: WalkData, state: StationState): Phase[] {
  const station = walk.stations[index]!;
  if (state === "absent") return [{ ms: 800, label: "skipped" }];
  if (state === "loading") return [{ ms: 800, label: "loading" }];
  if (state === "failed") return [{ ms: 800, label: "failed" }];
  const result = walk.results[index];
  const rows = (id: string): number => {
    const outcome = result?.queries[id];
    return outcome?.ok ? outcome.result.rows.length : 0;
  };
  switch (station.id) {
    // One phase, because there is one thing to see. A result-only section has no before and after
    // to cut between: the rows arrive whole or not at all.
    case "result":
      return [{ ms: 1600, label: "the rows it produces" }];
    case "from":
      return [{ ms: 700, label: "raw tables" }];
    case "join": {
      const kind = station.join?.kind ?? "inner";
      const settled =
        kind === "inner"
          ? "unmatched rows dropped"
          : kind === "cross"
            ? "every pair kept"
            : "unmatched rows kept";
      return [
        { ms: 1200, label: "matching keys" },
        { ms: 1000, label: "rows paired" },
        { ms: 800, label: settled },
      ];
    }
    case "where": {
      const n = rows("verdict") || rows("sample");
      return [
        { ms: n * STAGGER_MS + 700, label: `testing ${n} rows` },
        { ms: 900, label: "failing rows removed" },
      ];
    }
    case "group": {
      const keys = walk.parsed?.groupKeys.join(", ") ?? "";
      return [
        { ms: 1000, label: `sorting by ${keys}` },
        { ms: 1300, label: "gathering into buckets" },
        { ms: 1700, label: "one row per bucket" },
      ];
    }
    case "having": {
      const n = rows("verdict") || rows("sample");
      return [
        { ms: n * STAGGER_MS + 700, label: `testing ${n} groups` },
        { ms: 900, label: "failing groups removed" },
      ];
    }
    case "window": {
      const fn = walk.parsed ? windowFunctions(walk.parsed)[0] : undefined;
      const keys = fn?.partition.join(", ") ?? "";
      return [
        { ms: 1300, label: keys ? `panes by ${keys}` : "one pane, every row" },
        { ms: 1600, label: "a value for every row" },
      ];
    }
    case "select": {
      const phases: Phase[] = [
        { ms: 900, label: "dropping unused columns" },
        { ms: 900, label: "naming the output" },
      ];
      // The branch phase is only worth playing when the probe that knows which branch won came
      // back; without it the stage would hold on the phase before it and say nothing new.
      if (result?.queries.case?.ok) phases.push({ ms: 1500, label: "which branch won" });
      return phases;
    }
    case "distinct":
      return [
        { ms: 900, label: "finding duplicates" },
        { ms: 900, label: "duplicates merged" },
      ];
    case "order":
      return [
        { ms: 900, label: "sort key" },
        { ms: 1000, label: "sorted" },
      ];
    case "limit":
      return [
        { ms: 900, label: "cut line" },
        { ms: 900, label: "rest dropped" },
      ];
  }
}

/* ── The bound section ─────────────────────────────────────────────────────────────────────────
 *
 * A section that runs once per outer row has no station walk, so it has no station sentences. What
 * it has instead is one sentence about the section — what correlation means for it — and one about
 * whichever outer row is currently bound, which changes as playback moves through them.
 */

/**
 * One outer row's turn before playback binds the next.
 *
 * `HOLD_MS` is the rest every station takes on its settled state, and two row staggers is how long
 * the inner card's rows take to finish arriving, so a row holds for exactly as long as it takes to
 * look at. The speed control divides it the same way it divides every other schedule here.
 */
export const ROW_HOLD_MS = HOLD_MS + STAGGER_MS * 2;

/** What the predicate needs of the subquery's rows, as a noun phrase: "`exists` needs …". */
function passRule(kind: SubqueryPredicateKind): string {
  switch (kind) {
    case "not exists":
      return "no rows at all";
    case "exists":
      return "at least one row";
    case "in":
      return "a row holding the value on the left";
    case "not in":
      return "no row holding the value on the left";
    case "scalar":
      return "a single value the comparison holds against";
  }
}

/** `s.ID = '12345'`, the substitution this row's probe actually made, for a card title or a note. */
export function bindingText(plan: BoundPlan, row: BoundRow): string {
  return plan.columns
    .map((column) => `${column.ref} = ${row.literals.get(column.ref) ?? "null"}`)
    .join(", ");
}

/**
 * The title over the card of rows the subquery came back with.
 *
 * It says what the rows MEAN rather than repeating the binding, which the scrubber under the stage
 * is already showing: under `exists` they are what the predicate found, and under `not exists` they
 * are the evidence against the row — so an EMPTY card there is the good one, and a title that only
 * said `s.ID = '12345'` left the reader to work that out for themselves. IN and a scalar have cards
 * of their own with their own titles and never reach this.
 */
export function boundInnerTitle(plan: BoundPlan, row: BoundRow): string {
  const bound = bindingText(plan, row);
  switch (plan.predicate.kind) {
    case "exists":
      return `found for ${bound}`;
    case "not exists":
      return `what disqualifies ${bound}`;
    default:
      return bound;
  }
}

/** What this section IS: why it has no single result, and what its outer query wants from it. */
export function boundSentence(plan: BoundPlan): string {
  const columns = list(plan.columns.map((column) => code(column.ref)));
  const named = columns === "" ? "a value from the row it sits inside" : columns;
  return `Every row of ${plan.outer.label} hands this subquery its own ${named}, so it does not run once — it runs again for each of them, and the rows it comes back with change every time. ${code(plan.predicate.kind)} then passes the outer row only when the answer is ${passRule(plan.predicate.kind)}.`;
}

/** What happened for the row currently bound: the values put in, the rows that came back, the verdict. */
export function boundRowSentence(plan: BoundPlan, row: BoundRow): string {
  const bound = list(
    plan.columns.map((column) => code(`${column.ref} = ${row.literals.get(column.ref) ?? "null"}`)),
  );
  const answer =
    row.matches === null
      ? "the subquery runs with those values in place of the outer row's"
      : row.matches === 0
        ? "the subquery comes back empty"
        : `the subquery comes back with ${row.matches} ${row.matches === 1 ? "row" : "rows"}`;
  const verdict = row.pass ? "passes" : "fails";
  return `With ${bound}, ${answer}, so this row ${verdict}: ${code(plan.predicate.kind)} needs ${passRule(plan.predicate.kind)}.`;
}

/* ── IN and the scalar comparison ──────────────────────────────────────────────────────────────
 *
 * Both of these get a card of their own rather than the rows EXISTS shows, and both get a sentence
 * of their own for the same reason: what the subquery answered is a different KIND of thing. IN
 * answers whether a value is in a set. A scalar answers with one value, and has two failure modes
 * that no other predicate has — more than one row is an error, and no row at all is a null that
 * makes the comparison unknown rather than false.
 */

/** What `x in (…)` did for this row: the value on the left, and whether the set holds it. */
export function membershipSentence(plan: BoundPlan, row: BoundRow, answer: AnswerView): string {
  if (answer.kind !== "values") return boundRowSentence(plan, row);
  const negated = plan.predicate.kind === "not in";
  const found = answer.values.some((value) => value.match);
  const poisoned = answer.values.some((value) => value.poison);
  const bound = bindingText(plan, row);
  const rule = `${code(plan.predicateText)} passes a row when its ${code(answer.needleLabel)} is ${
    negated ? "none of" : "one of"
  } the values the subquery returns.`;
  // The null case is not "it is not in the list": it is that nothing can be PROVED about the list
  // at all, and saying "not in the list, so the row fails" would teach the wrong reason.
  if (negated && poisoned) {
    return `${rule} For ${code(bound)} the value is ${code(answer.needle)}, but the subquery returned a null among its values, so the row fails whatever that value is.`;
  }
  return `${rule} For ${code(bound)} the value is ${code(answer.needle)}, and it is ${
    found ? "in" : "not in"
  } the list, so the row ${row.pass ? "passes" : "fails"}.`;
}

/** What the scalar comparison came out as for this row, in the three cells the card shows. */
export function scalarSentence(plan: BoundPlan, row: BoundRow, answer: AnswerView): string {
  if (answer.kind !== "equation") return boundRowSentence(plan, row);
  const bound = bindingText(plan, row);
  const rule = `${code(plan.predicateText)} compares each row's ${code(answer.leftLabel)} against the one value the subquery returns.`;
  if (answer.many !== null) {
    return `${rule} For ${code(bound)} it returned ${answer.many} rows, which is not a value at all — the database raises an error rather than choosing one of them.`;
  }
  if (answer.missing) {
    return `${rule} For ${code(bound)} it returned no row, so the value is null, ${code(`${answer.left} ${answer.operator} null`)} is unknown rather than false, and the row is dropped exactly as a false one would be.`;
  }
  return `${rule} For ${code(bound)} the value is ${code(answer.right)}, and ${code(`${answer.left} ${answer.operator} ${answer.right}`)} is ${row.pass}, so the row ${row.pass ? "passes" : "fails"}.`;
}

/**
 * The NOT IN null trap, which is the reason `not exists` is usually what people mean.
 *
 * One null anywhere in the set is fatal to EVERY row, not just to rows that are null themselves,
 * and that is the part nobody predicts: `not in` is `<> all`, a comparison to null is unknown, and
 * a predicate that is unknown never passes a WHERE. Null when there is no null to warn about.
 */
export function notInNullSentence(plan: BoundPlan, answer: AnswerView): string | null {
  if (plan.predicate.kind !== "not in" || answer.kind !== "values") return null;
  if (!answer.values.some((value) => value.poison)) return null;
  // "this row" rather than "every row": the set a CORRELATED subquery returns is a different set
  // per outer row, so a null in one row's set says nothing about the next row's. The rule it
  // demonstrates is the same one, and it is the rule that costs people afternoons.
  return `The subquery returns a null among its values, and ${code("not in")} compares against every value with ${code("=")}; a comparison to null is unknown, so nothing can be proved absent and this row fails whatever its value is. One null anywhere in the set is enough, and over a set that does not change per row that is every row at once — which is the reason ${code("not exists")} is usually what people mean.`;
}

/** The promise a scalar subquery makes, and both ways of breaking it. Null for every other kind. */
export function scalarShapeSentence(plan: BoundPlan, answer: AnswerView): string | null {
  if (plan.predicate.kind !== "scalar" || answer.kind !== "equation") return null;
  return `A subquery in this position must return exactly one row: more than one is an error the database raises, and none at all is a null, which makes the comparison unknown and drops the row without ever being false.`;
}

/**
 * The null sentence, which is a lesson rather than an edge case.
 *
 * A correlated value that is null makes every comparison against it unknown, not false, so the
 * subquery matches nothing however full the table is. The walk writes `= null` rather than quietly
 * turning it into `is null`, because `= null` is what the database evaluates and repairing it would
 * hide the only reason this row's answer is empty.
 */
export function boundNullSentence(refs: readonly string[]): string | null {
  if (refs.length === 0) return null;
  const named = list(refs.map(code));
  const plural = refs.length > 1;
  return `${named} ${plural ? "are" : "is"} null on this row, so every comparison against ${plural ? "them" : "it"} is unknown rather than false and no row can match, however full the table is. ${code("= null")} is never true — not even against another null — which is why this answer is empty and why SQL has ${code("is null")} for the test people mean.`;
}

/** Why there is no match count, when there is none. Null when the count came back. */
export function boundCountSentence(plan: BoundPlan): string | null {
  if (plan.counting !== null) return null;
  return `There is no match count beside these rows. ${
    plan.wrapped
      ? "Counting a subquery of this shape means wrapping it in a derived table, and this database would not resolve the outer row through one — that is a limit of the dialect, not a fault in the query."
      : "This subquery already collapses to a single row whatever matched, so counting it would say 1 for every outer row and mean nothing."
  } The verdict beside each row is ${code(plan.predicate.kind)} itself, asked of the database, so it still holds.`;
}

/* ── The grid ──────────────────────────────────────────────────────────────────────────────────
 *
 * A doubly-correlated subquery gets three sentences rather than two, because it has three things
 * going on: what the section is, what happened for the bound OUTER row, and what happened in one
 * CELL. The third only exists once a reader has picked one.
 */

/** What a grid section IS: the loop it stands for, and what the predicate wants of it. */
export function gridSentence(plan: BoundPlan, grid: GridBuild): string {
  const refs = list(plan.columns.map((column) => code(column.ref)));
  const named = refs === "" ? "a value from the row it sits inside" : refs;
  const asks = grid.innerCondition
    ? `whether a row has ${code(grid.innerCondition)}`
    : "whether it has a row";
  const negativeInner = isNegativeKind(grid.innerKind);
  const rule = isNegativeKind(grid.middleKind)
    ? `passes the ${grid.rowNoun} only when no ${grid.driveNoun} comes back at all, which is to say only when every ${grid.driveNoun} ${negativeInner ? "found its match" : "failed to find one"}`
    : `passes the ${grid.rowNoun} as soon as one ${grid.driveNoun} comes back, which is to say as soon as a single ${grid.driveNoun} ${negativeInner ? "has no match" : "has one"}`;
  return `Every row of ${plan.outer.label} hands this subquery its own ${named}, so it runs once per ${grid.rowNoun} rather than once. Each run walks every row of ${code(grid.driveTitle)} and asks ${code(grid.innerSource)} ${asks}; a ${grid.driveNoun} ${negativeInner ? "with no such row" : "with such a row"} comes back as a row of this subquery. ${code(grid.middleKind)} then ${rule}.`;
}

/** What happened for the bound outer row, counted in driving rows rather than in bare matches. */
export function gridRowSentence(
  plan: BoundPlan,
  grid: GridBuild,
  row: BoundRow,
  columns: number,
): string {
  // Without a count there is no "3 of the 5" to write, and the ledger's own sentence already says
  // what can honestly be said about such a row.
  if (row.matches === null || columns === 0) return boundRowSentence(plan, row);
  const bound = list(
    plan.columns.map((column) => code(`${column.ref} = ${row.literals.get(column.ref) ?? "null"}`)),
  );
  const n = row.matches;
  // `1 of the 5 rows HAS`, `3 of the 5 rows HAVE`: the verb agrees with the count in front of it,
  // not with the rows behind it, and a sentence that gets that wrong reads as machine output.
  const have = `${n === 1 ? "has" : "have"} ${isNegativeKind(grid.innerKind) ? "no matching row in" : "a matching row in"}`;
  // The flourish is earned only in the case it describes: one row, under a predicate that needs
  // none. Anywhere else it would be a joke about a number that is not on screen.
  const twist = !row.pass && isNegativeKind(grid.middleKind) && n === 1 ? ", and one is not none" : "";
  return `With ${bound}, ${n} of the ${columns} rows of ${code(grid.driveTitle)} ${have} ${code(grid.innerSource)}, so this subquery comes back with ${n} ${n === 1 ? "row" : "rows"} and the ${grid.rowNoun} ${row.pass ? "passes" : "fails"}: ${code(grid.middleKind)} needs ${passRule(grid.middleKind)}${twist}.`;
}

/** What happened in the picked cell: the one place in the walk with two of the reader's own values
 *  spliced into one statement. `rows` is how many the cell's own probe found, when it has landed. */
export function gridCellSentence(args: {
  readonly grid: GridBuild;
  /** The substitutions the cell's SQL made, as `ref = literal` pairs. */
  readonly bound: readonly string[];
  readonly label: string;
  readonly returned: boolean;
  readonly rows: number | null;
}): string {
  const { grid, label, returned, rows } = args;
  const found = cellFound(returned, grid.innerKind);
  const has = found
    ? rows === null
      ? "has a matching row"
      : `has ${rows} ${rows === 1 ? "row" : "rows"}`
    : "has no such row";
  const tail = returned
    ? `${code(label)} is one of the rows this subquery returns for this ${grid.rowNoun}.${
        isNegativeKind(grid.middleKind) ? ` One ${grid.driveNoun} is all it takes.` : ""
      }`
    : `${code(label)} is not returned: this ${grid.driveNoun} counts as ${found ? "matched" : "unmatched"}.`;
  return `With ${list(args.bound.map(code))}, ${code(grid.innerSource)} ${has}, so the inner ${code(grid.innerKind)} is ${returned} and ${tail}`;
}

/* ── The terminus ──────────────────────────────────────────────────────────────────────────────
 *
 * The sentences under an empty result. Each one has the same shape — what failed, and what the
 * nearest row would have needed — and each one is written from numbers the walk already had. They
 * take plain arguments rather than the card, so `terminus.ts` can build the card by calling them
 * and neither file has to import the other's types.
 */

/** The card's own title, in the accessible name and above the rows. */
export const NEAREST_TITLE = "nearest to passing";

/**
 * The nearest-miss sentence for `not exists`: the one predicate with a real gradient.
 *
 * `short by exactly one` rather than `short by 1` in the case where it is one, because that is the
 * whole point of the card and a digit does not land the way the word does. The closing clause says
 * what a single extra row would have done, which is the sentence a reader can act on.
 */
export function nearMissSentence(args: {
  /** The outer query's FROM, as written: `student s`. */
  readonly outerSource: string;
  /** A noun for one outer row: `student`. */
  readonly rowNoun: string;
  readonly kind: SubqueryPredicateKind;
  /** The rows the subquery walks, when a grid named them: `RequiredCourses rc`. */
  readonly driveTitle: string | null;
  readonly driveNoun: string;
  /** The table the inner predicate reads: `takes`. */
  readonly innerSource: string | null;
  /** The nearest row, as its own columns spell it. */
  readonly name: string;
  readonly count: number;
  /** The values it was missing, when the grid's cells named them. */
  readonly missing: readonly string[];
}): string {
  const { outerSource, rowNoun, kind, driveTitle, driveNoun, innerSource, name, count } = args;
  const one = count === 1;
  const walked =
    driveTitle === null || innerSource === null
      ? `every ${rowNoun} comes back with at least one row from it`
      : `every ${rowNoun} has at least one row of ${code(driveTitle)} with no matching row in ${code(innerSource)}`;
  const named = args.missing.length > 0 ? `, ${list(args.missing.map(code))}` : "";
  const short = one
    ? `short by exactly one ${driveNoun}${named}`
    : `short by ${count} ${driveNoun}s${named}`;
  const fix =
    innerSource === null
      ? one
        ? "one row fewer and the query would return them"
        : `${count} rows fewer and the query would return them`
      : one
        ? `a single ${code(innerSource)} row for that pair and the query would return them`
        : `${count} more ${code(innerSource)} rows and the query would return them`;
  return `No row of ${code(outerSource)} survives ${code(kind)}: ${walked}. The nearest is ${code(name)}, ${short}; ${fix}.`;
}

/**
 * The sentence for a kind with NO gradient, which is `exists` and `not in`.
 *
 * Every row that fails an `exists` fails it with a count of zero, so there is no nearest and saying
 * there is would be the one thing this card must never do. What is left that is true is what the
 * subquery would have had to find, so that is what the sentence says — and it says explicitly that
 * the rows are not ranked, because three rows in a list look ranked whatever the header says.
 */
export function noGradientSentence(args: {
  readonly outerSource: string;
  readonly kind: SubqueryPredicateKind;
  readonly predicate: string;
  readonly innerSource: string;
  /** The binding the subquery ran with, for the first failing row: `s.ID = '12345'`. */
  readonly binding: string;
}): string {
  const { outerSource, kind, predicate, innerSource, binding } = args;
  const wanted =
    kind === "not in"
      ? `Each of these rows has its value among the ones ${code(innerSource)} returned, and ${code("not in")} passes a row only when it has none of them.`
      : `What it would have taken is a single row of ${code(innerSource)} — for the first of these, one with ${code(binding)}.`;
  return `No row of ${code(outerSource)} survives ${code(predicate)}, and every one of them failed it the same way: the subquery came back empty, so there is no nearest row and these three are not ranked. ${wanted}`;
}

/** The sentence for `in` and for a scalar comparison, where near means a distance between numbers. */
export function closestSentence(args: {
  readonly outerSource: string;
  readonly predicate: string;
  readonly name: string;
  readonly gap: string;
}): string {
  return `No row of ${code(args.outerSource)} survives ${code(args.predicate)}. Nearness here is a distance between numbers, so the rows are ordered by how far the compared value was from the one the subquery came back with: ${code(args.name)} is the closest, ${args.gap}.`;
}

/**
 * The fallback, for a WHERE with no bound chapter behind it.
 *
 * `measured` is what makes the second half true: the row test brings back one boolean per depth-zero
 * conjunct, so a row that failed one of three really did come closer than a row that failed all
 * three. A single-conjunct WHERE has no such measure and the sentence stops after the first line
 * rather than claiming an order nothing produced.
 */
export function genericTerminusSentence(body: string, measured: boolean): string {
  const failed = `Every row failed ${code(body)}.`;
  return measured
    ? `${failed} The rows above are the ones that came closest, ordered by how far they were from passing.`
    : `${failed} It is a single condition, so there is no sense in which one row came closer than another; these are simply the first of the rows it threw away.`;
}

/** One beat per outer row, labelled the way the phase caption above a station's sentence is. */
export function boundPhases(rows: readonly BoundRow[]): Phase[] {
  return rows.map((row, index) => ({
    ms: ROW_HOLD_MS,
    label:
      row.matches === null
        ? `row ${index + 1} of ${rows.length} · ${row.pass ? "passes" : "fails"}`
        : `row ${index + 1} of ${rows.length} · ${row.matches} ${row.matches === 1 ? "match" : "matches"}`,
  }));
}
