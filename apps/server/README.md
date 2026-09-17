# perch — server and CLI

The engine room of [perch](../../README.md), a lightweight SQL client for Postgres and MySQL.
`perch` is a single binary: the CLI starts, stops and inspects the local server, and everything
else — connections, schema, queries, files, history, settings — is the HTTP API that server
serves, which the UI is a pure client of.

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

`bun run dev` (root) skips the build and runs the CLI straight from TypeScript on Bun
(`bun src/cli/main.ts serve --no-open`). `bun run start` runs the built output on Node, which is
the other runtime this CLI has to work on — see CONTRIBUTING.md.

## Quick start

```sh
perch                       # start the UI + API and open a browser (serve is the default command)
perch serve --port 4600     # the same thing, explicitly, on a port of your choosing
perch status                # is a server running, and where
perch stop                  # stop it
```

Connections, schema, queries, files, history and settings are all reached over the HTTP API below
(and through the UI that sits on it).

## Commands

| Command                      | Example                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perch [serve]`              | `perch serve --port 4600 --dir ~/sql --no-open` — starts the local server (default command). Prints `perch v0.1.0 → http://127.0.0.1:4600` and opens it in your browser. If a server is already running (per `server.json`), just prints/opens its URL instead of starting a second one. `--dir` adds a workspace directory the file API may read/write from (repeatable; persisted to settings). `--ui <dir>` serves a prebuilt UI from disk. |
| `perch stop`                 | `perch stop` — sends `SIGTERM` to the running server (from `server.json`) and clears the file.                                                                                                                                                                                                                                                                                                                                                 |
| `perch status`               | `perch status --json` — prints the running server's info, or `not running`.                                                                                                                                                                                                                                                                                                                                                                    |
| `perch --version`            | prints the installed version                                                                                                                                                                                                                                                                                                                                                                                                                   |

Every command accepts `--help`, and `perch status` accepts `--json` for machine-readable output.
Both are handled by the one scaffold every command is built on, which also means a command called
without a required argument exits 1 with `missing <name>` and its usage line.

## HTTP API (`perch serve`)

There is no authentication: the server binds to `127.0.0.1`, and that loopback binding is the
only boundary.

| Path                                                     | Purpose                                                  |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/health`                                        | Server identity/version; the liveness probe.             |
| `GET /api/connections`                                   | List saved connections with live status.                 |
| `POST /api/connections`                                  | Create a connection (by URL or discrete fields).         |
| `PUT /api/connections/:id`                               | Update a connection.                                     |
| `DELETE /api/connections/:id`                            | Remove a connection.                                     |
| `POST /api/connections/:id/test`                         | Round-trip test; returns server version + latency.       |
| `POST /api/connections/:id/connect` \| `.../disconnect`  | Open/close the pooled driver.                            |
| `GET /api/connections/:id/databases`                     | List databases.                                          |
| `GET /api/connections/:id/schema`                        | Schema tree (cached 30s; `?refresh=1` bypasses).         |
| `POST /api/query`                                        | Run SQL, streaming NDJSON `RunEvent`s as they happen.    |
| `POST /api/query/sync`                                   | Run SQL, return the full `RunRecord` once finished.      |
| `POST /api/runs/:id/cancel`                              | Cancel an in-flight run.                                 |
| `GET /api/runs` \| `GET /api/runs/:id`                   | List/inspect runs kept in memory.                        |
| `GET /api/runs/:id/export`                               | Download a statement's results as CSV or JSON.           |
| `GET /api/history`                                       | Past runs from disk (survives restarts).                 |
| `GET /api/settings` \| `PUT /api/settings`               | Read/update local settings.                              |
| `GET /api/files` \| `.../content`                        | Browse/read `.sql` files inside configured workspaces.   |
| `PUT /api/files/content`                                 | Save a file (optimistic-concurrency via `ifModifiedAt`). |
| `POST /api/files` \| `DELETE /api/files` \| `.../rename` | Create/delete/rename `.sql` files.                       |
| `GET /`                                                  | The UI (if built and present), or an API index page.     |

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
