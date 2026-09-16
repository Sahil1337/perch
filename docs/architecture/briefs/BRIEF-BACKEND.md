# perch backend + CLI — build brief

Package: /Users/sahil/sql-engine/backend (Node >= 22, ESM, TypeScript strict, NodeNext resolution →
import local files with the `.js` suffix). Deps already installed: hono, @hono/node-server, pg,
pg-cursor, mysql2. Dev: tsx, vitest, typescript, eslint. Do NOT add packages. Node built-ins are fine
(node:util parseArgs, node:crypto, node:fs, node:child_process, node:sqlite is available but unused).

Read first: src/types.ts (the contracts — do not change exported shapes; you may add optional fields
and mention it), src/config/store.ts (perch home ~/.perch or $PERCH_HOME; connections,
settings, history, server.json). A local Postgres is running on localhost:5432 (user `sahil`, no
password, db `postgres`) for smoke tests; MySQL is NOT available locally — write the MySQL driver
carefully against mysql2's documented API and unit-test what you can without a server.

Product context: a tiny local SQL client. The UI (separate, later) is a pure HTTP client. The CLI
starts the server and is also usable on its own (run a file, list schema). Keep code small and
readable; no frameworks beyond hono. Every module `export`s plain functions/classes; no globals
except a single registry instance created in server/app.ts.

## Work package 1 — drivers (src/db/)
- `src/db/sql-split.ts`: `splitStatements(sql: string): { sql: string; offset: number }[]` —
  splits on `;` outside of single/double/dollar-quoted strings, line/block comments, and backticks;
  trims, drops empty statements; keeps the original char offset. Unit tests in sql-split.test.ts.
- `src/db/postgres.ts`: `class PostgresDriver implements Driver` using `pg.Pool` (max 4) and
  `pg-cursor` for streaming. `run()`: for each statement (via splitStatements) take a client from the
  pool, `SET statement_timeout` when opts.timeoutMs > 0, execute with a Cursor reading
  `batchSize` rows, emit `columns` (map `field.dataTypeID` to a type name using a small builtin OID
  table: 16 bool, 20 int8, 21 int2, 23 int4, 25 text, 700 float4, 701 float8, 1043 varchar, 1082
  date, 1114 timestamp, 1184 timestamptz, 1700 numeric, 2950 uuid, 3802 jsonb, 114 json, 1043
  varchar, 1042 bpchar, 1083 time, 1186 interval; else `oid:<n>`; align right for numeric/date types),
  emit `rows` batches until `maxRows`, then close the cursor (mark truncated). For statements that
  return no rows (DML/DDL) use `client.query` and report `affectedRows` = `rowCount` and `command`.
  Convert values for the wire: Date → ISO string, bigint/numeric strings stay strings, Buffer →
  `\\x..` hex, objects (json) → JSON string, undefined → null. Listen for `notice` on the client and
  emit `notice` events. Errors: map pg error `position` (1-based string) to `position` (0-based)
  and compute `line` within the statement; include `code`, `detail`, `hint`. On error, stop the
  run (remaining statements are not executed) and resolve "error". `cancel(runId)`: keep a map
  runId → { client, pid }; use a second pool client to `SELECT pg_cancel_backend($1)`; the running
  statement then errors with code 57014 — report the run as "cancelled", not "error".
  `listDatabases`: `select datname from pg_database where not datistemplate order by 1`.
  `getSchema(database?)`: if a different database is asked for, open a short-lived Client to it.
  Query information_schema/pg_catalog for schemas (exclude pg_catalog, information_schema,
  pg_toast), tables + views + matviews, columns (name, formatted type via
  `format_type(a.atttypid, a.atttypmod)`, nullable, default, pk via pg_index indisprimary,
  position), and `reltuples` as rowEstimate. One or two queries total, not N+1.
  `test()`: `select version()` and measure latency.
- `src/db/mysql.ts`: `class MysqlDriver implements Driver` using `mysql2/promise` pool
  (`multipleStatements: false`; we split ourselves). Streaming: use the non-promise connection's
  `.query(sql).stream({ highWaterMark })` or `connection.query(...)` with `on('fields')`/`on('result')`
  events; honour maxRows/batchSize; `cancel` via a second connection `KILL QUERY <threadId>`
  (mysql2's connection exposes `threadId`) → status "cancelled" (error code ER_QUERY_INTERRUPTED /
  1317). listDatabases: `show databases` minus information_schema, performance_schema, mysql, sys.
  getSchema: information_schema.tables/columns/key_column_usage; dialect-appropriate types; align.
  Type names from field types via mysql2's `Types` map (lower-case names).
- `src/db/index.ts`: `createDriver(config: ConnectionConfig): Driver`, and `parseConnectionUrl(url:
  string): Omit<ConnectionConfig,"id"|"name"|"createdAt">` accepting postgres://, postgresql://,
  mysql:// URLs (with ?sslmode=require or ?ssl=true). Unit tests for parseConnectionUrl.
- Integration test `src/db/postgres.test.ts` that is SKIPPED unless `PERCH_TEST_PG` is set
  (e.g. postgres://sahil@localhost:5432/postgres): runs `select 1 as x, now() as t`, a 3000-row
  generate_series with maxRows 1000 (expects truncated), a syntax error (expects error with
  position), DDL+DML in one run, and cancel of `select pg_sleep(5)` (expects "cancelled").

## Work package 2 — HTTP server (src/server/)
- `src/server/registry.ts`: `class Registry` holding live drivers by connection id (lazy create from
  store config, `connect()` on first use), run bookkeeping: `runs: Map<runId, RunRecord>` (in-memory
  cap 50, LRU by startedAt; results rows kept in memory for export), `startRun(connectionId, sql,
  opts, source, emit)`, `cancelRun(runId)`, `getRun`, `listRuns`. Appends to history via store on
  finish.
- `src/server/app.ts`: `createApp({ token, version, uiDir? }): Hono` with:
  - Auth middleware for `/api/*`: accept `Authorization: Bearer <token>`, cookie `perch_token`, or
    `?token=` on any request (then set the cookie, HttpOnly, SameSite=Lax, and for GET / redirect to
    the same URL without the token). 401 JSON otherwise. `/api/health` is public (returns
    ServerInfo without token).
  - Errors: a global handler returning `{ error: { message, code? } }` with 400/404/500.
  - Routes (JSON unless noted):
    GET  /api/health → ServerInfo
    GET  /api/connections → ConnectionSummary[] (status from registry, databases if connected)
    POST /api/connections { name, url? | (dialect,host,port,user,password,database,ssl) } → summary
    PUT  /api/connections/:id (same body, partial) → summary
    DELETE /api/connections/:id → { ok }
    POST /api/connections/:id/test → { serverVersion, latencyMs }
    POST /api/connections/:id/connect → summary   POST .../disconnect → summary
    GET  /api/connections/:id/databases → string[]
    GET  /api/connections/:id/schema?database= → DatabaseSchema (cache 30s per conn+db; `?refresh=1`)
    POST /api/query { connectionId, database?, sql, runId?, maxRows?, timeoutMs? } → NDJSON stream
         (content-type application/x-ndjson) of RunEvent, one per line, flushed as they happen;
         first line is `start` with the runId (server-generated if absent). Client disconnect
         cancels the run.
    POST /api/query/sync (same body) → RunRecord (convenience for CLI/tests; rows included)
    POST /api/runs/:id/cancel → { cancelled: boolean }
    GET  /api/runs → RunRecord[] (in-memory, without rows)   GET /api/runs/:id → RunRecord (with rows)
    GET  /api/runs/:id/export?format=csv|json&statement=0 → file download (Content-Disposition)
    GET  /api/history?limit=&connectionId= → RunRecord[] from store
    GET  /api/settings → Settings   PUT /api/settings (partial) → Settings
    GET  /api/files?dir=<abs> → FileEntry[] (only within settings.workspaces or dirs added via
         `--dir`; reject others with 403; `.sql` files and directories only; hidden files skipped)
    GET  /api/files/content?path= → { path, content, modifiedAt }
    PUT  /api/files/content { path, content, ifModifiedAt? } → { path, modifiedAt } (atomic write;
         409 if ifModifiedAt mismatches the current mtime — this is how autosave avoids clobbering)
    POST /api/files { dir, name } → FileEntry (creates empty .sql; 409 if exists)
    DELETE /api/files?path= → { ok }   POST /api/files/rename { path, name } → FileEntry
    Static UI: if `uiDir` exists, serve it at `/` with SPA fallback to index.html; otherwise GET /
    returns a tiny HTML page saying the UI is not installed and listing the API.
  - `src/server/files.ts`: path safety (`resolveWithin(roots, p)` — realpath, no `..` escapes,
    symlink-safe) with unit tests; `src/server/csv.ts`: RFC 4180 CSV writer with tests.
  - `src/server/start.ts`: `startServer({ port, host, token, open, extraDirs, uiDir }): Promise<{ url,
    close }>` using @hono/node-server; writes server.json via store (with pid, url, token); on
    SIGINT/SIGTERM disconnects drivers, clears server.json, exits. If `port` is in use, try the next
    free ports up to +10 unless `--port` was explicit.
- Tests with vitest using `app.request()` (Hono's test helper) against a fake Driver (no DB):
  auth 401/200, connections CRUD, query NDJSON streaming event order, files 403 outside roots,
  file PUT 409 on stale ifModifiedAt, csv export.

## Work package 3 — CLI (src/cli.ts + src/cli/)
- Entry `src/cli.ts` (`#!/usr/bin/env node` first line), parse with node:util `parseArgs`
  (allowPositionals). Commands (all `--json` capable where output is data; `--help` everywhere):
  perch [serve] [--port 4600] [--host 127.0.0.1] [--no-open] [--dir <path>]... [--ui <dir>]
      Starts the server (default cmd). If server.json points at a live server (GET /api/health ok),
      just open/print that URL instead of starting another. Prints `perch v0.1.0 → http://…
      /?token=…`. Opens the browser with the platform opener (open / xdg-open / start) unless
      --no-open. --dir adds workspace dirs (also persisted to settings.workspaces).
  perch stop                              (reads server.json, sends SIGTERM to pid, clears file)
  perch status                            (prints running server info or "not running")
  perch conn add <name> <url> [--test]     (url: postgres://user:pass@host:5432/db, mysql://…)
  perch conn add <name> --dialect --host --port --user --password|--password-stdin --database [--ssl]
  perch conn ls | perch conn rm <name> | perch conn test <name> | perch conn dbs <name>
  perch schema <conn> [--database db] [--table schema.table]   (tree view; --table shows columns)
  perch run <conn> (<file.sql> | -e "<sql>" | - for stdin) [--database db] [--format table|json|csv|ndjson]
      [--max-rows 1000] [--timeout ms]  → runs DIRECTLY through the driver (no server needed),
      prints each statement's result; table format = aligned columns with a footer
      "N rows · T ms"; exit 1 on SQL error with the message and a caret under the position.
  perch history [--limit 20] [--conn name]
  perch files ls [dir] | perch settings get | perch settings set <key> <value>
  perch --version
- `src/cli/format.ts`: table/csv/json/ndjson formatters (reuse server/csv.ts), with tests.
- `src/cli/open.ts`: cross-platform browser opener via child_process (spawn detached, ignore errors).
- Colors: only bold/dim via ANSI when stdout is a TTY; no color deps.
- README.md at package root: install (`npm i -g` from the folder / `npm link` for dev / `bun build
  --compile` for a single binary), quick start, every command with an example, the API table
  (paths + one-line purpose), perch home layout, security notes (loopback only, token, 0600
  files, passwords stored in plain JSON for now).

## Definition of done (each package)
`npm run typecheck`, `npm run lint`, `npm test` clean for your files. Reply under 25 lines: files
written, deviations, test status. Do not start long-running servers in the foreground; if you need
to smoke test the server, start it with `--no-open --port 4699` in the background, curl, then kill it.
