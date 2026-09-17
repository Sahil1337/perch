// One sentence per station, naming the real tables, keys and columns from the user's query.

import type { JoinClause, KeyPair } from "../clauses";
import { joinKeys, previousIndex, sampleId } from "../scenes";
import {
  caseExpressions,
  sourceTitle,
  WALK_PREFIX,
  type WindowFn,
  windowFunctions,
} from "../steps";
import type { WalkData } from "../use-walk";
import { code, list } from "./prose";

/**
 * A select-list subquery that became a chapter of its own: what it is called, and whether it ran
 * once for the whole query or once for every row.
 *
 * The SELECT station's own sentence is about columns being BORN — and one of these columns was not
 * born here at all, which is the one thing the station cannot say from the parse in front of it.
 */
export type ProjectionNote = {
  readonly label: string;
  readonly perRow: boolean;
};

/** `dept_name` and `dept_name and year`: the partition, named the way the user wrote it. */
function paneKeys(fn: WindowFn): string {
  return fn.partition.map(code).join(" and ");
}

/** `keys` is what the join was FOUND to match on, which for a natural join is not what it says. */
function joinCondition(join: JoinClause, keys: readonly KeyPair[] | null): string {
  if (join.natural) {
    // Null is "the sides have not both landed", and the columns cannot be named until they have.
    // The rule can be, though, and it is the half that matters: a reader who knows a natural join
    // matches on shared names already knows to go looking for one they did not intend.
    if (keys === null) return "the column names both sides share match";
    return `${list(keys.map((pair) => code(pair.left)))} ${keys.length === 1 ? "matches" : "match"}`;
  }
  if (join.using)
    return `${code(`using (${join.keys.map((pair) => pair.left).join(", ")})`)} matches`;
  if (join.keys.length === 0) return "the ON condition holds";
  return join.keys.map((pair) => code(`${pair.left} = ${pair.right}`)).join(" and ");
}

/** The half of a natural join's sentence that says where its condition came from. */
function naturalSource(keys: readonly KeyPair[] | null, left: string, right: string): string {
  if (keys === null || keys.length === 0) return "";
  const named = list(keys.map((pair) => code(pair.left)));
  return keys.length === 1
    ? ` Nothing in the query says ${named}: it is the one column name ${left} and ${right} share, and a natural join matches on every one of them.`
    : ` Nothing in the query says ${named}: those are the column names ${left} and ${right} share, and a natural join matches on every one of them, not just the one you had in mind.`;
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

/** The clause the SELECT sentence ends on when one of its columns came from a chapter of its own. */
function projectionsSentence(notes: readonly ProjectionNote[]): string {
  if (notes.length === 0) return "";
  const once = notes.filter((note) => !note.perRow).map((note) => code(note.label));
  const perRow = notes.filter((note) => note.perRow).map((note) => code(note.label));
  const parts: string[] = [];
  // Correlation is the whole difference, so each group gets the sentence that is true of it: one
  // value repeated down the column, or a different value worked out for every row.
  if (once.length > 0) {
    parts.push(
      once.length === 1
        ? `${list(once)} is a subquery with a chapter of its own, computed once before any of this, so the same value lands on every row`
        : `${list(once)} are subqueries with chapters of their own, each computed once before any of this, so the same values land on every row`,
    );
  }
  if (perRow.length > 0) {
    parts.push(
      perRow.length === 1
        ? `${list(perRow)} is a subquery that names the row it is computed for, so it runs again for every row and each one gets its own value`
        : `${list(perRow)} are subqueries that name the row they are computed for, so they run again for every row and each one gets its own values`,
    );
  }
  return ` ${parts.join(", and ")}.`;
}

export function sentenceFor(
  index: number,
  walk: WalkData,
  /** The select-list subqueries of the section being walked; empty for every station but SELECT. */
  projections: readonly ProjectionNote[] = [],
): string {
  const { parsed, stations } = walk;
  const station = stations[index]!;
  // A station that came with its own sentence is one nothing below could have written: the clause
  // vocabulary here describes what a SELECT does to rows, and a recursive CTE's three stations are
  // about three separate statements. It is checked before `result` because those three wear the
  // `result` id — they show a rows card, they are just not result-ONLY sections.
  if (station.sentence !== null) return station.sentence;
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
      const keys = joinKeys(walk, index, station);
      // A natural join between two sides that share no column name has nothing to match on, and a
      // database does not refuse it: it quietly becomes a cross join. Reaching the sentence below
      // would announce a condition that does not exist over a result that just squared.
      if (join.natural && keys !== null && keys.length === 0) {
        return `A natural join matches on the column names both sides share, and ${left} and ${right} share none. With no condition left to apply it pairs every row with every row, exactly as a cross join would.`;
      }
      const pair = `Pair each row of ${left} with its match in ${right} where ${joinCondition(join, keys)}.${join.natural ? naturalSource(keys, left, right) : ""}`;
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
      const born = projectionsSentence(projections);
      const branches = caseExpressions(parsed)[0];
      if (!branches) return `${base}${born}`;
      const fallback = branches.fallback
        ? `falls through to ${code(branches.fallback)}`
        : `comes out null, because this ${code("case")} has no ${code("else")}`;
      return `${base} The ${code("case")} is one of those columns: each row takes the first ${code("when")} that is true of it, and a row no branch claims ${fallback}.${born}`;
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
    // A combine always arrives with its own sentence, which the guard at the top of this function
    // has already returned, so nothing reaches here. `noSentence` names the one id left over, which
    // is what makes this an exhaustiveness check rather than a silent fallthrough.
    default:
      return noSentence(station.id);
  }
}

/**
 * The stations `sentenceFor` deliberately says nothing about.
 *
 * Today that is `combine` alone. The parameter type is the assertion: a station id added to
 * `StationId` without a case in the switch above fails the typecheck here, rather than reaching a
 * reader as a blank line under the card.
 */
function noSentence(_id: "combine"): string {
  return "";
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
