// Shared SQL text utilities for the frontend.
//
// `apps/server` does NOT import this package, and must not: it builds with plain `tsc` and ships
// to npm with five runtime dependencies, so a private `@perch/*` import would survive into `dist/`
// and break `npm i perch`. `@perch/protocol` only escapes that because types erase; a function
// does not. So `apps/server/src/core/sql/split.ts` stays the authority and this is a verbatim
// copy, kept honest by `bun run --filter @perch/sql check`.

export { splitStatements, type SplitStatement } from "./split";
export { scanComments, stripComments, type SqlComment } from "./comments";
export { formatSql, type FormatSqlOptions, type FormatSqlResult } from "./format";
