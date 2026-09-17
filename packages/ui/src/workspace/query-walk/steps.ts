// From the sliced clauses to the ordered stations, each with the SQL it samples and counts.
//
// Every query is the user's own text spliced together, so the "SQL that ran" block can show it and
// it means what the user wrote. A newline goes before anything appended: a `-- comment` at the end
// of a clause would otherwise swallow the `limit` that follows it.
//
// The builders moved into a family of modules; this is the path they are read through.
//
// - `station-types.ts`     what a station IS, and the factory every builder fills in
// - `walk-columns.ts`      the columns the walk appends for its own bookkeeping
// - `item-pieces.ts`       splitting one select item into words, without a parser
// - `window-fn.ts`         the window functions in a select list
// - `case-expr.ts`         the CASE expressions in a select list
// - `stations/select.ts`   the clause walk
// - `stations/set-op.ts`   one station per meeting of two results
// - `stations/recursion.ts` START, REPEAT, SETTLE
// - `stations/result.ts`   the one station a section with no clauses gets

export { caseExpressions } from "./case-expr";
/** The one definition lives in `clauses.ts`, where the parser and the query builders can both
 *  reach it; this keeps the name importable from here, which is where it was first spelled. */
export { WALK_PREFIX } from "./clauses";
export {
  countId,
  sampleId,
  sourceTitle,
  type Query,
  type Station,
  type StationId,
} from "./station-types";
export { buildRecursionStations } from "./stations/recursion";
export { buildResultStation } from "./stations/result";
export { buildStations } from "./stations/select";
export { buildSetStations } from "./stations/set-op";
export {
  bindColumn,
  branchColumn,
  CELL_COLUMN,
  conjunctColumn,
  driveColumn,
  LEFT_COLUMN,
  MATCH_COLUMN,
  memberColumn,
  memberNullColumn,
  PASS_COLUMN,
  SAMPLE_ROWS,
  WINDOW_COLUMN,
} from "./walk-columns";
export { windowFunctions, type WindowFn } from "./window-fn";
