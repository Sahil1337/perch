# Restructure brief

Move the existing code into the layout in STRUCTURE.md without changing behaviour. This is a
refactor: every existing test must still pass (moved next to its module), plus new unit tests
only where a module got split (e.g. url.ts, sql/split.ts keep theirs).

Steps
1. Create the folders. Move files with `git mv`-like care (plain mv; there is no git yet).
   Split `src/types.ts` into `src/core/types/*.ts` by topic with an `index.ts` barrel; keep every
   exported name identical. Split `src/config/store.ts` into `src/storage/*.ts` (paths, json-file,
   connections, settings, history, server-info) with a `src/storage/index.ts` barrel.
2. Split `src/server/app.ts` into `create-server.ts` + `middleware/*` + `routes/*` (one file per
   resource as listed) + `services/*`. Route registration functions take `(app, deps)`. Keep the
   exported `createApp(opts): Hono` and `createServer(opts)` signatures so start.ts and tests
   keep working. Move `registry.ts`, `files.ts` → `services/file-service.ts`, `watcher.ts`,
   `events.ts` → `services/event-bus.ts`, `csv.ts` → `http/csv.ts`, `test-driver.ts` →
   `testing/fake-driver.ts`. Extract the NDJSON streaming helper into `http/ndjson.ts`.
3. Split drivers: `db/postgres.ts` → `db/postgres/{driver,types,introspect}.ts`; same for mysql;
   `db/index.ts` → `db/factory.ts` + `db/url.ts` (+ a `db/index.ts` barrel re-exporting both, so
   `import { createDriver, parseConnectionUrl } from "../db/index.js"` keeps working);
   `db/sql-split.ts` → `core/sql/split.ts`. Shared cell conversion / align helpers → `db/driver.ts`
   if both drivers duplicate them.
4. CLI: `src/cli.ts` → `src/cli/main.ts`; commands → `src/cli/commands/*.ts`; `format.ts` →
   `src/cli/output/format.ts` (drop its private CSV writer and use `server/http/csv.ts` — or
   move csv to `core/csv.ts` if you prefer core to own it; pick one, no duplicate writers);
   `open.ts` → `src/cli/util/open-browser.ts`; `util.ts` → `src/cli/util/{errors,ansi,args}.ts`.
5. `src/index.ts` library barrel. package.json: `"bin": {"perch": "./dist/cli/main.js"}`, build
   chmod path, `"main"`/`"exports"` → dist/index.js, `files` unchanged. tsconfig: exclude
   `src/**/*.test.ts` and `src/server/testing/**` from `build` via a separate `tsconfig.build.json`
   (typecheck still covers everything). vitest config include pattern unchanged.
6. Move `smoke.sh` → `scripts/smoke.sh` (fix `CLI=` path), `BRIEF-*.md` → `docs/design/`, write
   `docs/API.md` from the routes (method, path, body, response, one line each). Update README
   paths and the CI workflow at ../.github/workflows/backend-ci.yml (smoke path, bin path).
7. ESLint: add `no-restricted-imports` rules enforcing the import direction in STRUCTURE.md
   (core must not import db/server/storage/cli; db must not import server/cli; storage must
   not import server/cli).
8. Definition of done: `npm run typecheck`, `npm run lint`, `npm test` (with
   PERCH_TEST_PG=postgres://sahil@localhost:5432/postgres), `npm run build`,
   `bash scripts/smoke.sh`, and `bun build src/cli/main.ts --compile --outfile /tmp/perch-check &&
   /tmp/perch-check --version` all green. No stray files at the package root. Reply under 25
   lines: final tree (folders only), anything you could not move cleanly, test status.
