# Brief: remove redundancy in apps/server

Behaviour-preserving. Every existing test keeps passing (move/rename tests as their modules move;
add tests only for new shared helpers). Wire shapes in @perch/protocol are untouched. Run from
apps/server: typecheck, `eslint apps/server/src` from the repo root, the full vitest suite with
PERCH_TEST_PG=postgres://sahil@localhost:5432/postgres, build, scripts/smoke.sh, and the
bun-compiled binary. Do not touch docs/, README files, workflows, or other workspaces; do not
commit. Keep files small but do not create a file per function: the target is one concern per
file, roughly 60–180 lines each.

## 1. Drivers: one run loop, two dialects   (db/)
`postgres/driver.ts` and `mysql/driver.ts` duplicate ~110 lines verbatim: lifecycle
(connect/disconnect/isConnected/requirePool), `test()`, the whole `run()` loop (option
normalisation, run-entry map, start/statement/done events, status aggregation), the
StatementResult assembly + `result` event, the timeout coercion, and the cancel-flag pattern.
Replace with:
- `db/base-driver.ts`: `abstract class BaseDriver<Handle> implements Driver`. Owns the `runs`
  map, `run()`, `cancel()` (sets the flag, then calls `abstract killHandle(handle)` if one is
  set), `test()` built on `abstract queryScalar(sql)`, `requirePool`, and option normalisation
  (`normalizeRunOptions(opts)` exported for tests). Subclasses implement:
  `openPool()`, `closePool()`, `listDatabases()`, `getSchema()`,
  `executeStatement(sql, ctx: StatementContext): Promise<void>` where the context gives them a
  `StatementSink` (below), `setHandle(h)`, `isCancelled()`, and `isCancellation(err)`.
- `db/statement-sink.ts`: `class StatementSink` that a dialect feeds with `columns(cols)`,
  `row(row)` / `rows(batch)`, `notice(msg)`, `affected(n)`, `command(c)`; it handles maxRows
  truncation (`truncated` flag + a `stop()` callback the dialect can pass in to close its cursor
  or destroy its stream), batching into `rows` events, and `finish(): StatementResult`
  emitting `result`. Unit-test it directly (truncation at the boundary, batching, empty result,
  DML with affectedRows).
- `db/driver.ts` keeps the `Driver` interface only. `RunEntry` disappears; the handle type is a
  generic (pg backend pid: number; mysql threadId: number).
- Result: postgres/driver.ts ≈ 140 lines (pool config, cursor loop feeding the sink, pid
  capture, pg_cancel_backend), mysql/driver.ts ≈ 120 lines (stream events feeding the sink,
  KILL QUERY). `commandOf(sql)` in mysql/types.ts stays.
- `server/testing/fake-driver.ts` extends BaseDriver too, keeping only the fake plan logic
  (currently 258 lines re-implementing the loop). Its public surface (`FakeDriver`, `FakePlan`,
  `defaultPlan`, `fakeCreateDriver`) must not change; app tests stay green.

## 2. One error type   (server/http/errors.ts)
`RegistryError` and `FileAccessError` are the same class twice (`status`, `code`, message);
`http/body.ts` imports RegistryError from services (http → services is the wrong direction).
Add `server/http/errors.ts` exporting `class HttpError extends Error { status; code }` with
tiny constructors `badRequest(msg, code?)`, `notFound(msg)`, `forbidden(msg)`, `conflict(msg)`.
Replace both classes with it (keep type-only aliases `RegistryError = HttpError` and
`FileAccessError = HttpError` exported from their old modules only if a test imports them by
name; otherwise update the tests). The error handler middleware checks `instanceof HttpError`.
`RouteDeps.fail` becomes unnecessary — remove it and throw directly.

## 3. Registry: split by concern   (server/services/)
`registry.ts` (390 lines) mixes four things. Split into:
- `connection-pool.ts` — `class ConnectionPool`: entries by id, `driverFor`, `connect`,
  `disconnect`, `forget`, `test`, `databases`, `summary`/`summaries`, `shutdown`. Uses the
  schema cache only via `getSchema`.
- `run-log.ts` — `class RunLog`: `remember`, `get`, `list` (newest first, rows stripped),
  `stripRows`. Eviction: runs start in time order, so a Map's insertion order already is
  LRU-by-startedAt; evict with `this.runs.keys().next().value` instead of the O(n) scan.
- `query-runner.ts` — `startRun(input, emit)` and `cancelRun`: builds the RunRecord, wires the
  capture (rows buffering per statement index), guarantees exactly one `done`, appends history,
  notifies. Takes `{ pool: ConnectionPool, log: RunLog, onRunFinished }`.
- `registry.ts` becomes a 40-line facade composing the three (so `RouteDeps.registry` and the
  tests' `new Registry(...)` keep working), or delete it and expose the three on RouteDeps —
  choose whichever leaves fewer forwarding methods; say which.
- `redactConnection(config): ConnectionSummary-shaped object without password` lives once in
  `storage/connections.ts` and is used by registry.summary AND `cli/commands/conn.ts`
  (which has its own `stripPassword`).

## 4. Workspace files: safety vs. I/O   (server/services/)
Split `file-service.ts` (196 lines, three concerns, and a doubled doc comment at lines 142–147):
- `workspace-paths.ts` — `resolveRoots`, `resolveWithin`, `realpathOrClosest`, `contains`,
  `safeFileName`, `isSqlFile`, `isHidden`, `SKIPPED_DIRS`, `SQL_EXT`. Pure path policy.
- `workspace-files.ts` — `listDir`, `entryFor`, `readTextFile`, `writeSqlFile` (atomic),
  `exists`, and `assertNotStale(full, ifModifiedAt)` which returns the 409 conflict payload
  that `routes/files.ts` currently builds inline (move that block out of the route).
- Atomic write exists twice (`storage/json-file.ts` and `file-service.ts`). One implementation:
  `util/atomic-write.ts` → `writeFileAtomic(path, data, { mode })` with the Windows rename
  retry; both callers use it. `util/errno.ts` → `errnoCode(err): string | undefined` replaces
  every `(err as NodeJS.ErrnoException).code` cast (grep `ErrnoException`).
- The existing `files.test.ts` splits accordingly.

## 5. CLI: one command scaffold   (cli/)
Each command re-declares `help`/`json` in parseArgs, re-checks `values.help`, prints its own
usage, and re-implements "look up the connection or die" although `requireConnection` already
exists in cli/util/args.ts. Add `cli/util/command.ts`:
```ts
defineCommand({ usage, options?, positionals?: string[] /* names, for the usage error */ },
  handler: (ctx: { values, positionals, json: boolean }) => Promise<void>)
```
which merges `help`/`json` into options, handles `--help`, validates required positionals,
and catches CliError → one-line message + exit 1. Rewrite the commands on it; use
`requireConnection` everywhere; delete the private `defaultPort` in conn.ts and export one from
`db/url.ts` (used by parseConnectionUrl too). `conn.ts` should drop to ~110 lines. Keep
`main.ts`'s lazy per-command imports.

## 6. Small things while there
- `ConnectionConfig` → driver config objects: postgres `clientConfig()` and mysql
  `poolOptions()` both spread the same five fields + ssl; put `baseDriverOptions(config)` in
  `db/driver.ts`.
- `isCancellation` stays per dialect (different error codes) — that is not redundancy.
- Remove any now-dead export; `src/index.ts` re-exports the new modules.

Reply under 30 lines: what moved where, line counts before/after for the five areas, anything
deliberately left as is, and the status of each check.

## Decision: the library barrel is not yet a public API
`src/index.ts` (package `main`/`exports`) was added in 13ac787 and has no consumers; the package
is unpublished at 0.1.0. This refactor therefore changes the barrel freely — `Registry`,
`RegistryError` and `FileAccessError` are removed, and the new modules (`ConnectionPool`,
`RunLog`, `startRun`/`cancelRun`, `HttpError`) are exported instead. No compatibility shims.
The HTTP API and the CLI are the behaviour-preservation surface; the 125 server tests are the
net, and any test that had to change to stay green is listed in the report as a behaviour move,
not absorbed silently. `HttpError` is a runtime value and lives in `server/http/errors.ts`,
never in `@perch/protocol` (types-only by guard).
