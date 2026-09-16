// One sentence per station, naming the real tables, keys and columns from the user's query, and
// the phases each station plays through.

import type { JoinClause } from "./clauses";
import { previousIndex, sampleId } from "./scenes";
import { caseExpressions, sourceTitle, WALK_PREFIX, type WindowFn, windowFunctions } from "./steps";
import type { StationState, WalkData } from "./use-walk";

export type Phase = { readonly ms: number; readonly label: string };

/** Gap between one row's test and the next, in WHERE and HAVING. */
export const STAGGER_MS = 110;
/** Rest on a station's settled state before playback moves on. */
export const HOLD_MS = 1000;

const code = (text: string): string => `\`${text.replace(/\s+/g, " ").trim()}\``;

/** `dept_name` and `dept_name and year`: the partition, named the way the user wrote it. */
function paneKeys(fn: WindowFn): string {
  return fn.partition.map(code).join(" and ");
}

function joinCondition(join: JoinClause): string {
  if (join.using) return `${code(`using (${join.keys.map((pair) => pair.left).join(", ")})`)} matches`;
  if (join.keys.length === 0) return "the ON condition holds";
  return join.keys.map((pair) => code(`${pair.left} = ${pair.right}`)).join(" and ");
}

export function sentenceFor(index: number, walk: WalkData): string {
  const { parsed, stations } = walk;
  const station = stations[index]!;
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
      const keys = walk.parsed.groupKeys.join(", ");
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
      const fn = windowFunctions(walk.parsed)[0];
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
