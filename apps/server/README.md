# perch — server and CLI

The engine room of [perch](../../README.md), a lightweight SQL client for Postgres and MySQL.
`perch` is a single CLI binary that can start a local web UI server, or run SQL directly from your
terminal without any server at all.

> The package is still named `perch` and the binary `perch`; the rename to perch is in
> progress, docs first. Commands below are what you type today.

## Install

This package lives at `apps/server` in the monorepo; run workspace scripts from the repo root
with `bun run --filter perch <script>`. It is published to npm and runs on **Node** ≥ 22 —
Bun is the repo's package manager, not this server's runtime.

```sh
# Install globally from source (from apps/server)
npm i -g .

# Or, for development: symlink the `perch` bin into your PATH. The bin is
# ./dist/cli/main.js, so run `bun run --filter perch build` first and after each edit.
npm link

# Or, compile a single self-contained binary (no Node required to run it)
bun run --filter perch compile     # bundles src/cli/main.ts → apps/server/dist/perch
./apps/server/dist/perch --help
```

`bun run dev` (root) skips the build and runs the CLI straight from TypeScript with `tsx`
(`tsx src/cli/main.ts serve --no-open`).

## Quick start

```sh
perch conn add local postgres://sahil@localhost:5432/postgres   # save a connection
perch conn test local                                             # check it connects
perch run local -e "select 1"                                     # run SQL, no server needed
perch schema local                                                 # browse tables
perch serve                                                        # start the UI + API, opens a browser
```

## Commands

| Command | Example |
|---|---|
| `perch [serve]` | `perch serve --port 4600 --dir ~/sql --no-open` — starts the local server (default command). Prints `perch v0.1.0 → http://127.0.0.1:4600` and opens it in your browser. If a server is already running (per `server.json`), just prints/opens its URL instead of starting a second one. `--dir` adds a workspace directory the file API may read/write from (repeatable; persisted to settings). `--ui <dir>` serves a prebuilt UI from disk. |
| `perch stop` | `perch stop` — sends `SIGTERM` to the running server (from `server.json`) and clears the file. |
| `perch status` | `perch status --json` — prints the running server's info, or `not running`. |
| `perch conn add` | `perch conn add local postgres://user:pass@host:5432/db --test`, or with explicit flags: `perch conn add prod --dialect mysql --host db.internal --user app --password-stdin --database app` |
| `perch conn ls` | `perch conn ls --json` — lists saved connections (never prints passwords). |
| `perch conn rm` | `perch conn rm local` — removes a saved connection. |
| `perch conn test` | `perch conn test local` — round-trips `select version()` (or equivalent) and prints latency. |
| `perch conn dbs` | `perch conn dbs local` — lists databases visible to the connection. |
| `perch schema` | `perch schema local`, or `perch schema local --table public.orders --json` — schema/table tree, or one table's columns. |
| `perch run` | `perch run local query.sql`, `perch run local -e "select * from orders limit 10"`, `cat q.sql \| perch run local -` — runs SQL **directly through the driver**, no server involved. `--format table\|json\|csv\|ndjson`, `--max-rows`, `--timeout`, `--database`. Exits 1 on SQL error, printing a caret under the error position. |
| `perch history` | `perch history --limit 20 --conn local [--json]` — recent runs (CLI and UI) from local history. |
| `perch files ls` | `perch files ls ~/sql --json` — lists `.sql` files and subdirectories in a directory (hidden entries skipped). |
| `perch settings get` / `set` | `perch settings get maxRows`, `perch settings set autosave false` |
| `perch --version` | prints the installed version |

Every command accepts `--help`; commands that print data accept `--json` for machine-readable
output. Both are handled by the one scaffold every command is built on, which also means a
command called without a required argument exits 1 with `missing <name>` and its usage line.

## HTTP API (`perch serve`)

There is no authentication: the server binds to `127.0.0.1`, and that loopback binding is the
only boundary.

| Path | Purpose |
|---|---|
| `GET /api/health` | Server identity/version; the liveness probe. |
| `GET /api/connections` | List saved connections with live status. |
| `POST /api/connections` | Create a connection (by URL or discrete fields). |
| `PUT /api/connections/:id` | Update a connection. |
| `DELETE /api/connections/:id` | Remove a connection. |
| `POST /api/connections/:id/test` | Round-trip test; returns server version + latency. |
| `POST /api/connections/:id/connect` \| `.../disconnect` | Open/close the pooled driver. |
| `GET /api/connections/:id/databases` | List databases. |
| `GET /api/connections/:id/schema` | Schema tree (cached 30s; `?refresh=1` bypasses). |
| `POST /api/query` | Run SQL, streaming NDJSON `RunEvent`s as they happen. |
| `POST /api/query/sync` | Run SQL, return the full `RunRecord` once finished. |
| `POST /api/runs/:id/cancel` | Cancel an in-flight run. |
| `GET /api/runs` \| `GET /api/runs/:id` | List/inspect runs kept in memory. |
| `GET /api/runs/:id/export` | Download a statement's results as CSV or JSON. |
| `GET /api/history` | Past runs from disk (survives restarts). |
| `GET /api/settings` \| `PUT /api/settings` | Read/update local settings. |
| `GET /api/files` \| `.../content` | Browse/read `.sql` files inside configured workspaces. |
| `PUT /api/files/content` | Save a file (optimistic-concurrency via `ifModifiedAt`). |
| `POST /api/files` \| `DELETE /api/files` \| `.../rename` | Create/delete/rename `.sql` files. |
| `GET /` | The UI (if built and present), or an API index page. |

## Layout

`src/` is layered: `cli/` (the `perch` binary) → `server/` (the Hono API) → `db/` (the drivers) →
`core/`, with `storage/` (everything under `~/.perch`) shared by the CLI and the server and
`util/` leaf-level. The dialect-independent half of a driver lives in `db/base-driver.ts` and
`db/statement-sink.ts`; the server's long-lived services (`pool`, `runLog`, `runner`) are wired in
`server/services/create-services.ts` and handed to the routes as one `RouteDeps`. The full
commented tree, the import rules ESLint enforces, and the build are in
[docs/architecture/server-structure.md](../../docs/architecture/server-structure.md).

There is no test suite in this repo. What a change has to clear instead — typecheck, lint, build,
a CLI smoke on the Node/OS matrix, and `scripts/smoke.sh` against a real Postgres, the only
end-to-end exercise of the HTTP API — is described there and in
[docs/architecture/monorepo.md](../../docs/architecture/monorepo.md).

## perch home

Everything perch keeps on your machine lives under `~/.perch` and nowhere else (override with
`PERCH_HOME`):

```
~/.perch/
  connections.json   saved connections, incl. passwords (mode 0600)
  settings.json      autosave, maxRows, workspaces, theme, ...
  history.jsonl      append-only run history (no result rows kept on disk)
  server.json        pid/url of the currently running server (mode 0600), if any
  queries/           the default workspace: created on first server start and set as the only
                     workspace root when settings name none. `serve --dir` adds more.
```

## Security notes

- The server binds to `127.0.0.1` by default and has no authentication — that loopback binding is
  the only boundary. `serve --host <addr>` past localhost lets anyone who can reach the address
  run queries, and prints a warning saying so.
- `connections.json` and `server.json` are written with mode `0600`.
- Passwords are currently stored **in plain JSON** in `connections.json` — do not commit or share
  that file. This is fine for a local dev tool but is not a secrets vault.
