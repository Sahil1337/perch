# Server structure (`apps/server`)

The published `perch` package: the `perch` CLI and the HTTP API, in one workspace. Nothing at
the package root except config files, `README.md`, and the standard folders.

This file describes the tree **as it is today**.

## The tree

```
apps/server/
├── package.json  tsconfig.json  tsconfig.build.json  README.md
│                             (no eslint.config.js — one config at the repo root covers this)
├── scripts/
│   ├── smoke.sh              end-to-end smoke against a local Postgres — the only thing that
│   │                         exercises the HTTP API end to end (see "No tests, and the gate")
│   │                         (run it as `bun run --filter perch smoke` from the root)
│   └── postbuild.mjs         chmod +x on dist/cli/main.js after `tsc`
└── src/
    ├── cli/                  everything the `perch` binary does: serve, stop, status
    │   ├── main.ts           the entry point (shebang, --version/--help, dispatch).
    │   │                     package.json "bin" → dist/cli/main.js. The command module is
    │   │                     imported lazily, so --version never loads the HTTP server.
    │   ├── commands/         one module per command group — thin: parse args, call, print.
    │   │   │                 Every one is a `defineCommand({...}, handler)` (see below)
    │   │   └── serve.ts      `perch serve` (the default command), `perch stop`, `perch status`
    │   └── util/             CLI leaf helpers, re-exported from util/index.ts
    │       ├── command.ts    defineCommand(): the scaffold every command is built on
    │       ├── ansi.ts       TTY styling; every helper no-ops off a TTY or under NO_COLOR
    │       └── errors.ts     CliError — expected failures print as one line, no stack
    ├── core/                 framework-free, no I/O, no dependencies on any other layer
    │   ├── sql/split.ts      statement splitter (strings, identifiers, comments, $$ bodies)
    │   └── version.ts        VERSION, read from package.json with a compiled-binary fallback
    ├── db/                   the driver layer
    │   ├── driver.ts         the Driver contract every dialect implements, plus
    │   │                     baseDriverOptions() — the connection fields pg and mysql2 spell
    │   │                     the same way. Server-internal: nothing here crosses the wire, so
    │   │                     it is not in @perch/protocol.
    │   ├── base-driver.ts    BaseDriver<Pool, Handle>: the half of a driver that has nothing
    │   │                     to do with a dialect — pool lifecycle, the run loop (one `start`,
    │   │                     one `statement` each, one `done`), the cancel flag and the
    │   │                     per-run handle, test(), and normalizeRunOptions()
    │   ├── statement-sink.ts StatementSink: everything one statement produces on its way to
    │   │                     the client — the maxRows cut (with the `stop()` a pushing dialect
    │   │                     registers), batching rows into `rows` events, the StatementResult
    │   ├── factory.ts        createDriver(config) — the one dialect → class mapping
    │   ├── url.ts            parseConnectionUrl(), defaultPort() — postgres/postgresql/pg,
    │   │                     mysql/mariadb. defaultPort lives here, not in the CLI.
    │   ├── index.ts          the layer's public face: the factory, URL parsing, the drivers
    │   ├── postgres/
    │   │   ├── driver.ts     dialect only: pg pool (max 4) + pg-cursor feeding the sink, the
    │   │   │                 backend pid, pg_cancel_backend
    │   │   ├── types.ts      OID → type name, pg value → wire Cell, pg error → QueryError
    │   │   ├── column-source.ts
    │   │   │                 field tableID/columnID → ResultColumn.source, one lookup per
    │   │   │                 statement, cached per database for the connection's lifetime
    │   │   └── introspect.ts the schema tree straight out of pg_class / pg_attribute
    │   └── mysql/
    │       ├── driver.ts     dialect only: mysql2 streams feeding the sink (streaming reaches
    │       │                 through to the callback connection), the thread id, KILL QUERY
    │       ├── types.ts      mysql2 type code → name, value → Cell, error → QueryError
    │       └── introspect.ts the schema tree out of information_schema
    ├── storage/              on-disk state under ~/.perch (PERCH_HOME overrides)
    │   ├── paths.ts          where perch home is; configDir(), defaultQueriesDir(), the filenames
    │   ├── json-file.ts      temp-file + rename writes, so a crash never half-writes a file
    │   ├── connections.ts    connections.json (0600 — it may hold passwords); also
    │   │                     redactConnection(), shared by the CLI and the connection pool
    │   ├── settings.ts       settings.json, merged over defaultSettings on every read;
    │   │                     ensureDefaultWorkspace() creates ~/.perch/queries on first run
    │   ├── history.ts        history.jsonl, append-only; rows are stripped before they land
    │   ├── server-info.ts    server.json (0600); how `perch status` and `perch stop` find us
    │   └── index.ts          one import site for the CLI and the server
    ├── server/               the HTTP layer (Hono)
    │   ├── create-server.ts  createServer(opts) → { app, bus, services, watcher, close };
    │   │                     createApp(opts) → Hono. Owns only the wiring: middleware order,
    │   │                     the shared RouteDeps, and the lifetimes that outlive a request.
    │   │                     Pure: no listening socket, so a caller can drive it with
    │   │                     `app.request()`.
    │   ├── start.ts          binds the port (scans upward unless --port was explicit), writes
    │   │                     server.json, handles SIGINT/SIGTERM
    │   ├── middleware/
    │   │   └── error-handler.ts  one envelope for the whole API: { error: { message, code? } }
    │   ├── routes/           one module per group, each exporting register<X>Routes(app, deps)
    │   │                     health · events · connections · discover · schema · query · runs ·
    │   │                     history · settings · files · ui  (registered in that order; ui is
    │   │                     last because both of its halves end in a `*` route)
    │   ├── services/         the things that outlive a single request
    │   │   ├── create-services.ts  createServices(opts) → { pool, runLog, runner }: the three
    │   │   │                 are wired together here and nowhere else
    │   │   ├── connection-pool.ts  live drivers by connection id — the one piece of shared
    │   │   │                 mutable state about databases; connect/disconnect/test/databases,
    │   │   │                 summaries (redacted), schema through the cache
    │   │   ├── run-log.ts    the bounded in-memory record of recent runs; stripRows()
    │   │   ├── query-runner.ts  startRun/cancelRun: builds the RunRecord, forwards every driver
    │   │   │                 event while accumulating it, guarantees exactly one `done`,
    │   │   │                 appends to history
    │   │   ├── schema-cache.ts  TTL cache (30s) of introspected schemas, keyed conn + database
    │   │   ├── discovery/    finds the Postgres/MySQL already on this machine. Every probe is
    │   │   │   │             parallel, capped and non-throwing; sightings merge on
    │   │   │   │             dialect+host+port. 30s memo.
    │   │   │   ├── index.ts        discoverServers() + DiscoveryService (the memo)
    │   │   │   ├── types.ts        Sighting, timeouts, default ports
    │   │   │   ├── exec.ts         child processes and fs, each swallowing its own failures
    │   │   │   ├── parse.ts        version banners, dialect names, docker port mappings
    │   │   │   ├── ports.ts        TCP probe — the only one that proves a server is up
    │   │   │   ├── binaries.ts     PATH, then the per-platform install dirs
    │   │   │   ├── service-managers.ts  brew / systemd / Windows services
    │   │   │   ├── docker.ts       containers publishing a database port
    │   │   │   └── merge.ts        sightings -> one row per server
    │   │   ├── workspace-paths.ts  path *policy*, no I/O: resolveWithin() (realpaths roots and
    │   │   │                 target), isSqlFile, isHidden, SKIPPED_DIRS
    │   │   ├── workspace-files.ts  the I/O, once a path has cleared workspace-paths: listDir,
    │   │   │                 entryFor, read, atomic write, assertNotStale() (the 409 body)
    │   │   ├── watcher.ts    OS-native fs watching of the workspace roots (no polling)
    │   │   └── event-bus.ts  in-process pub/sub feeding the SSE stream
    │   └── http/             response framing and body coercion, shared by the routes
    │       ├── errors.ts     HttpError + badRequest/notFound/forbidden/conflict, and ApiError
    │       ├── body.ts       readJsonBody() plus the str/num/bool coercions every route needs
    │       ├── ndjson.ts     one JSON value per line, flushed in order (POST /api/query)
    │       ├── sse.ts        `event: <type>` frames plus the `: ping` keep-alive
    │       └── csv.ts        RFC 4180 writer, behind GET /api/runs/:id/export?format=csv
    ├── util/                 leaf helpers; import nothing from the other layers
    │   ├── atomic-write.ts   writeFileAtomic(): temp file + rename, with the Windows rename
    │   │                     retry (EPERM/EBUSY while an editor or scanner holds the target)
    │   ├── errno.ts          errnoCode(err) — the ErrnoException cast, written once
    │   └── open-browser.ts   best-effort cross-platform URL launcher (detached, never throws)
    └── index.ts              the library barrel (see "The library barrel" below).
                              package.json "main"/"types"/"exports" point here.
```

The wire types are **not** here. They live in [`@perch/protocol`](../../packages/protocol); the
server imports them as `import type { … } from "@perch/protocol"`. There is no `core/types/`.
Anything that crosses the wire belongs in the protocol package; anything server-internal (the
`Driver` interface, `ConnectionPoolOptions`, `RouteDeps`) stays beside its implementation.

## Import direction

```
cli  →  server  →  db  →  core
       ╰── storage ──╯          storage/ is shared by cli/ and server/
            util/               leaf-level; importable by anyone, imports nobody
```

A layer may only import downward. Concretely, as
[`eslint.config.js`](../../eslint.config.js) states it:

| Layer        | May not import                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `core/**`    | `db/**`, `server/**`, `storage/**`, `cli/**` — the bottom layer: `@perch/protocol`, node builtins and `util/` only |
| `db/**`      | `server/**`, `cli/**`, `storage/**` — a driver layer; `core/` and `util/` only                                     |
| `storage/**` | `server/**`, `cli/**`, `db/**` — on-disk state; `core/` and `util/` only                                           |
| `server/**`  | `cli/**` — shared helpers belong in `src/util/`                                                                    |
| `util/**`    | every other layer                                                                                                  |
| anything     | `@perch/client` — that is the browser-side API client                                                              |

`cli/**` and `src/index.ts` sit at the top and may import anything below them; the `@perch/client`
ban still applies to both.

This is enforced, not just written down: `serverLayering` in the root
[`eslint.config.js`](../../eslint.config.js) is a set of `no-restricted-imports` patterns. Its
file globs are repo-relative (`apps/server/src/db/**`, ...) and flat config resolves them against
the directory holding the config file, so they match only inside `apps/server` and behave the
same whether you run `bun run lint` from the root or `bun run --filter perch lint`.

## How a route module gets what it needs

`createServices(opts)` builds the three long-lived services — `{ pool, runLog, runner }` — and is
the only place they are wired to each other. `create-server.ts` takes that object (or calls
`createServices()` itself when the caller passed none), spreads it into one `RouteDeps` and hands
that to every `register<X>Routes(app, deps)`. A route file never reaches back into
`create-server.ts` for a value, and never constructs a pool, a watcher or a bus of its own — which
is why adding a route group is a new file plus one `register…` line, and why an embedder or a
harness can substitute its own `createDriver` without touching any route.

`RouteDeps` is `ServerServices` (`pool`, `runLog`, `runner`) plus the identity (`version`,
`startedAt`, `url`, `uiDir`), the other lifetimes (`bus`, `watcher`, `openStreams`), and two
helpers the routes would otherwise each re-derive: `workspaceRoots()` and `safePath()`. There is
no `fail` helper — a route throws an `HttpError` and the error handler turns it into the envelope.

The two exports other code depends on are unchanged: `createServer(opts)` returns
`{ app, bus, services, watcher, close }`, and `createApp(opts)` is the narrower door onto the same
thing, returning just the Hono app.

## Errors

One error type crosses the whole HTTP layer. `server/http/errors.ts` exports `HttpError` (an
`Error` carrying `status` and `code`) and the four constructors everything throws:
`badRequest(msg, code?)`, `notFound(msg)`, `forbidden(msg)`, `conflict(msg)`. There is no
`RegistryError` and no `FileAccessError` — they were the same class twice.

`registerErrorHandler` honours exactly two shapes: Hono's own `HTTPException` and `HttpError`,
each answering with the status it carries. Anything else that reaches it is a bug, so it is logged
and answered 500. The codes clients can see are listed in [the API reference](../api/http.md).

## Drivers

A dialect module implements the dialect and nothing else. `BaseDriver<Pool, Handle>` owns the run
loop, the option normalisation (`normalizeRunOptions`), cancellation and the per-run handle;
`StatementSink` owns everything one statement produces — the `maxRows` cut, the batching of rows
into `rows` events, and the `StatementResult` assembly. A new dialect supplies a pool, a way to
run one statement into a sink, and its own notion of what a cancellation looks like
(`isCancellation` is genuinely per-dialect and stays there).

## The CLI scaffold

Every command is `defineCommand({ usage, options?, positionals? }, handler)` from
`cli/util/command.ts`. The scaffold merges `--json` and `--help` into the options (so no command
declares them), prints `usage` for `--help`, checks the positionals the command cannot run
without, and turns a `CliError` into one clean line plus exit code 1. A missing required
positional exits 1 with `missing <name>` followed by the usage line.

## The library barrel

`src/index.ts` is the package's public surface — `main`, `types` and `exports` all point at it. It
exports 50 runtime names:

- **Version and SQL** — `VERSION`, `splitStatements`
- **Drivers** — `createDriver`, `PostgresDriver`, `MysqlDriver`, `BaseDriver`, `StatementSink`,
  `normalizeRunOptions`, `parseConnectionUrl`, `defaultPort`
- **Server** — `createServer`, `createApp`, `startServer`, `DEFAULT_HOST`,
  `DEFAULT_PORT`, `PORT_SCAN`
- **Services** — `createServices`, `ConnectionPool`, `RunLog`, `QueryRunner`, `SchemaCache`,
  `EventBus`, `FileWatcher`, `stripRows`, `DiscoveryService`, `discoverServers`,
  `DISCOVERY_TTL_MS`
- **Errors** — `HttpError`, `badRequest`, `notFound`, `forbidden`, `conflict`
- **CSV** — `toCsv`, `csvCell`, `csvRow`
- **Storage** — `configDir`, `listConnections`, `getConnection`, `upsertConnection`,
  `removeConnection`, `saveConnections`, `redactConnection`, `getSettings`, `saveSettings`,
  `defaultSettings`, `appendHistory`, `readHistory`, `readServerInfo`, `writeServerInfo`,
  `clearServerInfo`

plus the types that go with them (`Driver`, `RunOptions`, `StatementContext`, `RouteDeps`,
`ServerServices`, `ApiError`, …).

Nothing in the monorepo imports it; it exists for embedders. `Registry`, `RegistryError` and
`FileAccessError` were removed outright, with no compatibility shims — a deliberate decision, on
the grounds that the barrel landed in 13ac787 with no consumers and the package is unpublished at
0.1.0. The behaviour-preservation surface is the HTTP API and the CLI, not this
list.

## No tests, and the gate

**This repo carries no test suite.** There are no `*.test.ts` files, no Vitest, and no `test`
script in any workspace. What stands in for one:

- `.github/workflows/server.yml` — `typecheck`, `lint`, `build` and a CLI smoke
  (`--version`, `status`) run on **Node** across 22/24 × ubuntu/windows/macos, plus a second job
  that runs `apps/server/scripts/smoke.sh` against a real Postgres service container.
  **That smoke script is the only end-to-end exercise of the HTTP API** — it starts a server,
  drives the routes and shuts it down. It is load-bearing, not a nicety; do not drop it.
- `.github/workflows/packages.yml` — protocol typecheck, `bun run --filter @perch/protocol check`
  (the types-only guard) and client typecheck.
- `.github/workflows/web.yml` — lint, typecheck and build for the mockups.

Node, not Bun, runs anything that executes the CLI: the package ships to npm, declares
`engines.node >=22` and imports `node:` builtins, so the matrix has to exercise the runtime it is
published for. `typecheck` and `lint` are runtime-agnostic and go through Bun.

## The build

- `tsconfig.json` includes all of `src`, so `bun run --filter perch typecheck` covers every
  file in the package.
- `tsconfig.build.json` extends it and turns `declaration` on (the package publishes
  `dist/index.d.ts`). Its `exclude` list still names `src/**/*.test.ts` and `src/server/testing/**`;
  both now match nothing.
- `bun run --filter perch build` is `tsc -p tsconfig.build.json` followed by
  `scripts/postbuild.mjs`, which marks `dist/cli/main.js` executable.
- `@perch/protocol` is the contract shared with every frontend. Keep shapes stable; add optional
  fields rather than changing existing ones.
