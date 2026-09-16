# HTTP API

Everything the UI and the CLI can ask the server for. Served by `perch serve`: the routes are
registered in
[`apps/server/src/server/create-server.ts`](../../apps/server/src/server/create-server.ts) and
implemented one group per file under
[`apps/server/src/server/routes/`](../../apps/server/src/server/routes); the browser-side wrapper
is [`@perch/client`](../../packages/client).

All response and request shapes name types from
[`@perch/protocol`](../../packages/protocol/src) rather than restating their fields — the package
is the contract, this page is the index.

## Access

There is no authentication. The server binds to `127.0.0.1`, so the boundary is the loopback
interface: only processes on this machine can reach it. `perch serve --host <addr>` past loopback
publishes the API to anyone who can route to that address, and says so on startup.
`perch serve --allow-origin <origin>` additionally lets a UI dev server on another origin read the
API from a browser (plain CORS, no credentials).

## Errors

Every failure is `{ "error": { "message": string, "code"?: string } }` with an appropriate
status. A route throws an `HttpError`
([`server/http/errors.ts`](../../apps/server/src/server/http/errors.ts)) and the error handler
turns it into that envelope; Hono's own `HTTPException` answers with its status and no code.

| Code | Status | Raised by |
|---|---|---|
| `bad_request` | 400 | the default for `badRequest()` — bad body, bad query param, a non-`.sql` path |
| `forbidden` | 403 | a path outside the configured workspace roots, or no roots configured |
| `not_found` | 404 | an unknown connection, run or file — and any unmatched route |
| `conflict` | 409 | a duplicate connection name, a file that already exists, a run id already executing |
| `stale_write` | 409 | `PUT /api/files/content` when `ifModifiedAt` does not match disk |
| `connect_failed` | 400 | the pooled driver could not connect |
| `test_failed` | 400 | `POST /api/connections/:id/test` could not round-trip |

Anything else reaching the handler is a bug: it is logged server-side and answered 500 with a
message and no code.

## Health

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| GET | `/api/health` | — | `ServerInfo` | Name, version, pid, url, start time and perch home — the liveness probe. |

## Events

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| GET | `/api/events` | — | `text/event-stream` of `ServerEvent` | One long-lived SSE stream per UI: file changes, finished runs, workspace-root changes. |

Each frame is `event: <ServerEvent["type"]>` with the whole event as JSON in `data`. The stream
opens with a `hello` and a `roots` event, and emits a `: ping` comment every 25s so proxies do
not drop it. Detection is push-based (OS file watching); the ping is pure keep-alive.

## Connections

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| GET | `/api/connections` | — | `ConnectionSummary[]` | Every saved connection with its live status. Passwords are never returned. |
| POST | `/api/connections` | `{ url }` or partial `ConnectionConfig` fields | `ConnectionSummary` (201) | Create a connection. `url` is a `postgres://`/`mysql://` shorthand that fills in the discrete fields; explicit fields win over it. 409 if the name is taken. |
| PUT | `/api/connections/:id` | same as POST | `ConnectionSummary` | Update a connection, merging the body over the stored config, and drop the pooled driver. |
| DELETE | `/api/connections/:id` | — | `{ ok: boolean }` | Forget the driver and remove the saved connection. |
| POST | `/api/connections/:id/test` | — | `{ serverVersion: string, latencyMs: number }` | Round-trip the connection without keeping it open. |
| POST | `/api/connections/:id/connect` | — | `ConnectionSummary` | Open the pooled driver eagerly. |
| POST | `/api/connections/:id/disconnect` | — | `ConnectionSummary` | Close the pooled driver. |
| GET | `/api/connections/:id/databases` | — | `string[]` | Databases visible to the connection. |
| GET | `/api/connections/:id/schema` | — | `DatabaseSchema` | Schema → table → column tree. `?database=` picks a non-default database; `?refresh=1` bypasses the cache. |

`:id` accepts either the connection id or its name.

## Discovery

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| GET | `/api/discover` | — | `DiscoveryResult` | Postgres/MySQL servers already on this machine — open ports, binaries, brew/systemd/Windows services, docker containers — merged by dialect+host+port. Best-effort and never fails; the result is memoised for 30s and `?rescan=1` forces a fresh scan. |

## Queries and runs

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| POST | `/api/query` | `{ connectionId, sql, database?, runId?, maxRows?, timeoutMs?, batchSize?, source? }` | `application/x-ndjson`, one `RunEvent` per line | Run SQL and stream results as they arrive: one JSON object per line, flushed in order. |
| POST | `/api/query/sync` | same as `/api/query` | `RunRecord` | The same run, buffered into a single reply. Convenient for small queries. |
| POST | `/api/runs/:id/cancel` | — | `{ cancelled: boolean }` | Cancel an in-flight run. |
| GET | `/api/runs` | — | `RunRecord[]` | Recent runs from memory, newest first, **without result rows** — fetch one run to get its rows. |
| GET | `/api/runs/:id` | — | `RunRecord` | One run in full, rows included. 404 once it has aged out of memory. |
| GET | `/api/runs/:id/export` | — | `text/csv` or `application/json` attachment | Download one statement's rows. `?format=csv` (default) or `json`; `?statement=<n>` picks the statement, default 0. |
| GET | `/api/history` | — | `RunRecord[]` | Runs from `history.jsonl` on disk, so they survive a restart. `?limit=` (1–1000, default 50) and `?connectionId=`. No result rows are kept on disk. |

An unknown `connectionId` is rejected with 404 **before** the streaming response starts, so a
client never has to parse a stream to discover the connection was wrong. If the client
disconnects mid-stream the server chases the cancel until it lands or the run finishes on its
own. Errors inside a started run arrive as an `error` `RunEvent` followed by `done`, not as an
HTTP status.

## Settings

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| GET | `/api/settings` | — | `Settings` | Current local settings, defaults filled in. |
| PUT | `/api/settings` | `Partial<Settings>` | `Settings` | Patch settings; unknown and ill-typed keys are ignored. Changing `workspaces` re-roots the file watcher and emits a `roots` event on the SSE stream. |

## Files

All paths are resolved inside the configured workspace roots (`settings.workspaces` plus any
`--dir`), realpathed first so `..` and symlinks cannot escape. Only `.sql` files can be read or
written; a path outside the roots is a 403.

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| GET | `/api/files` | — | `FileEntry[]` | `?dir=` lists that directory; with no `dir`, lists the workspace roots themselves. |
| GET | `/api/files/content` | — | `{ path, content, modifiedAt }` | Read one `.sql` file. `?path=` is required. |
| PUT | `/api/files/content` | `{ path, content, ifModifiedAt? }` | `{ path, modifiedAt }` | Atomic save. With `ifModifiedAt`, a mismatch is a 409 `stale_write` carrying the on-disk `modifiedAt`, `size`, and (under 512 KB) the current `content`, so the UI can diff without a second request. |
| POST | `/api/files` | `{ dir, name }` | `FileEntry` (201) | Create an empty `.sql` file. 409 if it exists. |
| POST | `/api/files/rename` | `{ path, name }` | `FileEntry` | Rename within the same directory. 409 if the target exists. |
| DELETE | `/api/files` | — | `{ ok: true }` | Delete the `.sql` file at `?path=`. |

A write made through this API is registered with the watcher, so it does not come back to the
client as an external file change.

## Everything else

| Method | Path | Response | Purpose |
|---|---|---|---|
| GET | `/*` (non-`/api/`) | static assets, SPA fallback to `index.html` | The built UI, when the server was given one (`perch serve --ui <dir>`, or the `ui/` directory inside the installed package). |
| GET | `/` | HTML | When no UI bundle is installed: a placeholder page listing the API. |
