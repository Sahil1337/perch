// The query walk: a SELECT animated through FROM, JOIN, WHERE, GROUP BY, HAVING, SELECT, DISTINCT,
// ORDER BY and LIMIT, with the rows and counts the connected database returns at each station.
// Every step query is the user's own text spliced together, and the narrator shows exactly what ran.

export { parseSelect, type ParsedSelect, type Unsupported } from "./clauses";
export { QueryWalkDialog } from "./query-walk-dialog";
export {
  QUERY_WALK_EVENT,
  type QueryWalkEventDetail,
  requestQueryWalk,
} from "./query-walk-event";
