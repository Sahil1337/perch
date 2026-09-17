// The columns the walk appends to a query for its own bookkeeping, and the caps on how many it
// will add.
//
// Every one of them carries `WALK_PREFIX`, so a name the walk invented can never collide with a
// name the user wrote. None of them is ever shown: the scene reads them off the result and drops
// them before the card is drawn.

import type { Dialect } from "@perch/protocol";
import { inLists, WALK_PREFIX, type InList, type ParsedSelect } from "./clauses";

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

export const MAX_IN_LISTS = 3;

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
