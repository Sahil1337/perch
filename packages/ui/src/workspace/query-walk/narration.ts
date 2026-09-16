// One sentence per station, naming the real tables, keys and columns from the user's query, and
// the phases each station plays through.

import type { BoundPlan, BoundRow } from "./bound";
import type { JoinClause, SubqueryPredicateKind } from "./clauses";
import { cellFound, isNegativeKind, type GridBuild } from "./grid";
import { previousIndex, sampleId } from "./scenes";
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
