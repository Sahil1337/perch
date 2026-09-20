# Server structure (`apps/server`)

The server is a single Go module (`perch`) that builds to one binary with the web UI inside it.
It has three direct dependencies — `pgx/v5`, `go-sql-driver/mysql`, `fsnotify` — and uses the
standard library for everything else, including routing, CORS, SSE, NDJSON, CSV and the embed.

The HTTP surface it serves is specified in [docs/api/http.md](../api/http.md). That page is the
contract; this one is how the code behind it is arranged.

## The tree

```
apps/server/
├── go.mod                    module perch, Go 1.25
├── main.go                   the CLI: serve (default), stop, status
├── package.json              scripts only — turbo and `--filter perch` reach the .sh files
│                             through it; no npm dependencies
├── scripts/
│   ├── build.sh              stages apps/server/ui into webui/static, then go build
│   │                         (--all cross-compiles every release target)
│   ├── dev.sh                go run . serve, allow-listing the vite dev origin
│   ├── build.bat             the Windows convenience copy of build.sh
│   ├── smoke.sh              the end-to-end suite; drives ./dist/perch
│   └── smoke-fixtures.sql    the tables smoke.sh expects
│
├── protocol/                 everything that crosses the wire; the Go half of @perch/protocol
│   ├── protocol.go           Dialect, Align, ISOTime — and the three JSON rules that keep Go's
│   │                         defaults from diverging from the TypeScript the UI parses
│   ├── connection.go         ConnectionConfig (on disk) and ConnectionSummary (on the wire,
│   │                         spelled out separately so Password cannot reach it)
│   ├── query.go              ResultColumn, Row, StatementResult, RunRecord, and RunEvent as
│   │                         one struct per variant with constructors that set the tag
│   ├── schema.go files.go settings.go events.go server.go discovery.go
│
├── server/                   the HTTP layer: one file per route group, plus the shared state
│   ├── server.go             wiring only — middleware order, what outlives a request, CORS
│   ├── start.go              binds a port (scanning upward), writes server.json, shuts down
│   ├── bus.go                fans ServerEvents to open SSE streams; non-blocking sends
│   ├── pool.go               live drivers by connection id + the schema TTL cache. The seam
│   │                         where a driver's plain error becomes an answerable HTTP failure
│   ├── runner.go             builds the RunRecord, forwards events, guarantees one `done`,
│   │                         appends to history
│   ├── runlog.go             the in-memory run log (50), so /runs/:id can serve rows
│   ├── workspace.go          path policy: realpath both sides, .sql only, no escaping a root
│   ├── wsfiles.go            reading and writing the workspace once a path has cleared policy
│   ├── health.go browse.go events.go settings.go files.go connections.go
│   ├── query.go runs.go ui.go
│
├── db/                       the database layer; returns plain errors, never HTTP ones
│   ├── driver.go             the Driver contract, the run loop, cancellation bookkeeping
│   ├── sink.go               one statement's output: the maxRows cut, row batching, the result
│   ├── cell.go               driver value → wire Cell, in the shapes node-postgres and mysql2
│   │                         produced (int8 and numeric as strings, ISO timestamps, \x hex)
│   ├── postgres.go           pools, statement execution, cancel via pg_cancel_backend
│   ├── pgtypes.go            OID → name, error → QueryError, the row-returning heuristic
│   ├── pgintrospect.go       the schema tree, three catalog queries
│   ├── columnsource.go       relation oid + attnum → table and column names, cached
│   ├── mysql.go              the same shape over database/sql; cancel via KILL QUERY
│   ├── mysqlintrospect.go    the schema tree from information_schema
│   └── url.go                postgres:// and mysql:// parsing, and the driver factory
│
├── storage/                  ~/.perch: connections.json (0600), settings.json, history.jsonl,
│                             server.json, update.json, and the queries/ workspace made on
│                             first run
├── update/                   `perch update`: the releases API, the checksum gate, and the
│                             rename over the running binary. Asset names are install.sh's
├── sqlscript/                statement splitting; mirrored by packages/sql/src/split.ts
├── discover/                 local database discovery: ports, binaries, docker, services
├── watch/                    fsnotify, with the recursion Go does not give you
├── httpx/                    the error envelope, JSON replies, SSE and NDJSON framing
├── fsx/                      atomic write (temp file + rename, with the Windows retry)
└── webui/                    //go:embed of static/, which build.sh fills. static/.gitkeep is
                              committed so the embed compiles in a clean checkout
```

## Import direction

`main → server → db`, with `storage/` shared, and `protocol/`, `httpx/`, `fsx/`, `sqlscript/`
leaf-level. `update/` hangs off `main` alone — replacing the binary is a CLI job, and the server
has no business reaching for it.

The rule with teeth is that **`db/` must not import `server/`**. The HTTP error envelope belongs
to the server, so drivers return plain errors and `server/pool.go` is the one place that turns a
failed connect into a `connect_failed` 400. Go's compiler rejects import cycles, which enforces
most of the direction for free; the rest is convention, and there is no linter for it the way
`serverLayering` used to police the TypeScript.

## How a route gets what it needs

Every route is a method on `*Server` registered in `routes()`, so there is no dependency bag to
thread: the pool, the runner, the bus and the watcher are fields. Handlers have the signature
`func(http.ResponseWriter, *http.Request) error` and are wrapped by `httpx.Wrap`, which is what
turns a returned error into the envelope.

Routing is the standard library's `ServeMux`, using the method-and-wildcard patterns Go 1.22
added: `s.handle("POST /api/connections/{id}/test", …)` and `r.PathValue("id")`.

## Errors

One envelope, `{"error": {"message", "code"?}}`, produced by `httpx.Wrap`. An `*httpx.Error`
answers with the status and code it carries; anything else is a bug, is logged, and answers 500.
`httpx.Conflict` takes a details bag that is written *beside* the envelope rather than inside it —
that is how the stale-write 409 returns the file as it is on disk now.

## Drivers

`db.Driver` is nine methods. Both implementations embed `base`, which owns the run loop (one
`start`, one `statement` per statement, one `done`), the cancellation flag and the per-statement
bookkeeping; each dialect supplies four hooks — execute a statement, kill a handle, recognise a
cancellation, convert an error. That is the Go shape of what `BaseDriver` did with inheritance.

Streaming has no cursor. pgx reads a result set message by message rather than buffering it, so
`conn.Query` plus an early `Close` on the maxRows cut does what `pg-cursor` was there for.
Statements that are not row-returning go through `pgx.QueryExecModeSimpleProtocol`, the only one
that can run e.g. `VACUUM`.

## No tests, and the gate

The repo carries no test suite and none gets committed. The gate is `go build ./...`,
`go vet ./...`, `gofmt -l` and `scripts/smoke.sh` against a real Postgres — the only end-to-end
exercise of the HTTP API, and the reason the port could be trusted at all: it passes identically
against the binary and against the TypeScript server it replaced.

CI adds a `cross-compile` job. It exists to fail the moment a dependency stops being pure Go,
because `CGO_ENABLED=0` is what lets one machine build all five targets.

## The build

`scripts/build.sh` empties `webui/static`, copies `apps/server/ui` (written by
`@perch/web`'s build) into it, and runs `go build -trimpath -ldflags="-s -w -X main.Version=…"`.
Emptying first matters: asset filenames are hashed, so a stale file would never be overwritten
and would ride into the binary alongside its replacement.

Building without a UI is not an error — the binary serves the API and answers `/` with a notice
saying the UI was not built. That is the shape CI's `cli` job exercises.
