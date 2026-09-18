# Porting `apps/server` to Go

Why: distribution is one self-contained binary per platform, and the target is under 30 MB. A
`bun build --compile` binary is 64.9 MB, of which 60.2 MB is the Bun runtime — perch's own code,
dependencies and UI are 4.7 MB of it. No Bun flag removes the runtime, so the size target is only
reachable by leaving JavaScript.

`apps/web`, `packages/ui`, `packages/client` and `packages/sql` stay TypeScript. The HTTP
contract in [docs/api/http.md](../api/http.md) is the specification and does not change; the UI is
a pure HTTP client and cannot tell which language answers it.

## Status

**Done and cut over.** The Go module is `apps/server` (module `perch`, 6.8k lines); the
TypeScript server was deleted on 2026-09-18. `bun run dev`, `build`, `lint`, `typecheck` and
`smoke` all drive it, and CI builds it with Go.

This page is kept as the record of why the port happened and what changed behaviourally.

**Measured on 2026-09-18**, `go build -trimpath -ldflags="-s -w"` with the UI embedded:

| target | size |
| --- | --- |
| darwin/arm64 | 14.5 MB |
| darwin/amd64 | 15.2 MB |
| linux/amd64 | 14.9 MB |
| linux/arm64 | 14.2 MB |
| windows/amd64 | 15.3 MB |

Against 64.9 MB for the Bun binary: **4.5× smaller, half the 30 MB budget**. All five cross-compile
from one machine because `CGO_ENABLED=0` holds — every dependency is pure Go.

**Conformance**: `apps/server/scripts/smoke.sh`, pointed at the Go binary, reports **37 ok, 0
failed** — identical to the same suite against the TypeScript server, down to the byte count of
its stderr. That covers connect/test/databases/schema, sync and streaming queries, cancel,
read-only sessions, column `source`, CSV export, workspace file CRUD with the 403/409 cases,
`record:false` probes, history and `perch status`.

## Libraries

Three direct dependencies; everything else is the standard library.

| Need | Choice |
| --- | --- |
| Postgres | `github.com/jackc/pgx/v5` (native API) |
| MySQL | `github.com/go-sql-driver/mysql` via `database/sql` |
| File watching | `github.com/fsnotify/fsnotify` |
| Routing, middleware, CORS, JSON, SSE, NDJSON, CSV, atomic writes, flags, discovery, UI embedding | stdlib |

`net/http`'s Go 1.22 `ServeMux` covers every route pattern (`POST /api/connections/{id}/test`), so
no framework. pgx's native API rather than `database/sql` because `pgconn.FieldDescription` carries
`TableOID` and `TableAttributeNumber`, which is what resolves the `source` field.

## Layout

The full commented tree is in [server-structure.md](server-structure.md). In outline:

```
apps/server/
  main.go          CLI: serve, stop, status
  server/          HTTP: one file per route group, pool, runner, run log, watcher wiring
  db/              driver contract, postgres, mysql, value mapping, introspection
  storage/         ~/.perch documents
  protocol/        the wire types
  sqlscript/       statement splitting
  discover/        local database discovery
  watch/           fsnotify wrapper
  httpx/ fsx/      error envelope + streaming, atomic writes
  webui/           embed.FS; webui/static is filled by scripts/build.sh
```

No `internal/` or `cmd/` — nothing imports this module, so the extra nesting bought nothing.

## Deviations from the TypeScript implementation

Behaviour is the same; the structure differs where Go has a better answer.

- **No cursor.** `pg-cursor` existed so a large result set never landed in memory. pgx reads the
  result stream message by message already, so `conn.Query` plus an early `Close` on the maxRows
  cut does the same job. Statements that are not row-returning use
  `pgx.QueryExecModeSimpleProtocol`, the only one that can run e.g. `VACUUM`.
- **Values are mapped explicitly** (`db/cell.go`) to the shapes node-postgres and mysql2 produced,
  not Go's defaults: `int8` and `numeric` are strings so nothing rounds in the browser, timestamps
  are ISO with milliseconds, `bytea` is `\x` hex, `uuid` is canonical, arrays and json are
  stringified. Verified against a live Postgres 18.4 across 13 types.
- **`affectedRows` is null for DDL.** Go's `CommandTag.RowsAffected()` returns 0 where
  node-postgres returned null, which would claim a statement affected nothing rather than that the
  count does not apply. `affectedOf` only reports a count when the tag carries one.
- **The backend pid comes free.** pgx already knows it, so the `select pg_backend_pid()` round trip
  per statement is gone.
- **MySQL picks Query or Exec from the statement text**, because `database/sql` exposes affected
  rows only from `Exec`. The TypeScript driver streamed both through one path.
- **Recursive watching is manual.** fsnotify watches a single directory on every platform, so
  `watch/` walks the roots and adds directories as they appear.

## Open items

1. **MySQL is unverified.** No MySQL server was running to test against. The Postgres path is
   covered by the smoke suite; the MySQL driver compiles and mirrors it, and nothing more.
2. **MySQL loses `source`.** Confirmed by reading the driver: `mysqlField` keeps `tableName`
   unexported and `database/sql`'s `ColumnType` exposes nothing about a column's origin, so the
   `{table, column}` the API documents for MySQL cannot be produced. Either switch MySQL to
   `github.com/go-mysql-org/go-mysql`, whose client exposes the full field metadata, or accept
   that the UI feature degrades on MySQL. **This is a product call, not a technical one.**
3. **MySQL notices are gone** for the same reason: the OkPacket `info` string is not exported.
4. **`@perch/protocol` is still hand-mirrored.** The Go structs in `protocol/` match the
   TypeScript by hand today. The plan is to generate the TypeScript from the Go with `tygo` and
   have CI fail on a stale checkin, so the package stays types-only and single-source.
5. **No release workflow yet.** `scripts/build.sh --all` produces every target and CI
   cross-compiles them on each PR, but nothing attaches them to a GitHub release.
6. **The split.ts guarantee is gone.** `packages/sql/src/split.ts` and
   `apps/server/sqlscript/split.go` were byte-identical TypeScript checked by
   `assert-in-sync.mjs`; across two languages nothing can diff them, so that check was deleted
   and the agreement is now maintained by hand. A shared fixture file both implementations are
   checked against would restore it, at the cost of the no-tests policy.
7. **Tests**: none committed, per AGENTS.md. The type mapping and the splitter in particular
   would be cheap to cover with table tests if that policy is ever revisited.

## What the cutover touched

`apps/server` replaced wholesale (keeping `LICENSE`, `README.md` and `scripts/smoke.sh`); root
`package.json` scripts reordered so `build` runs web before the server; `eslint.config.js` lost
`serverLayering`; `packages/sql` lost its cross-language sync check; `.github/workflows/server.yml`
rewritten for Go with a `cross-compile` job; `AGENTS.md`, `CONTRIBUTING.md`, both architecture
docs, `docs/api/http.md` and both READMEs updated; `bun.lock` lost 69 lines of server
dependencies.

The Go package that carries the embedded UI is `webui/`, not `ui/`, because `apps/web`'s postbuild
owns `apps/server/ui/` and wipes it on every build.
