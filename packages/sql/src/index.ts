// Shared SQL text utilities for the frontend.
//
// `splitStatements` here and `Split` in the server's Go `sqlscript` package are two
// implementations of one rule, and they have to agree: the editor offers to run a range and the
// server runs it. They used to be byte-identical TypeScript, checked mechanically. Across two
// languages nothing can check it, so a change to either must be made to both by hand.

export { splitStatements, type SplitStatement } from "./split";
export { scanComments, stripComments, type SqlComment } from "./comments";
export { formatSql, type FormatSqlOptions, type FormatSqlResult } from "./format";
