# Live wiring: apps/web against the real server

Goal: `apps/web` runs against `perch serve` for real. Replace the mock provider with a live one that
implements `WorkspaceApi` (packages/ui/src/workspace/types.ts — read it whole; it was just
extended with `addConnection/updateConnection/removeConnection/testConnection`, `source`,
`resolveConflict`, and `Buffer.conflict`) using `@perch/client` only. No component in packages/ui
may import @perch/client; apps/web/lib is the only place that does.

Read first: docs/design/prototype-spec.md, docs/api/http.md, packages/client/src/_, apps/web/lib/
mock-workspace.tsx (the reference implementation of the contract, keep its structure and its
derived-not-stored patterns), apps/web/lib/use-panels.ts, apps/server/src/server/routes/_.ts
(the truth for shapes), packages/protocol/src/*.

Files you own: apps/web/lib/live-workspace.tsx (new), apps/web/lib/workspace-source.ts (new),
apps/web/lib/server-client.ts (new), apps/web/app/page.tsx ONLY the lines that pick the provider
(nothing else in that file — another agent's onboarding/settings components get integrated later
by the orchestrator), packages/client/src/** (additive only), apps/web/lib/fixtures.ts (leave).
Do not touch packages/ui except additive helpers in packages/ui/src/workspace/types.ts if truly
needed (say so). Do not touch apps/server. No new packages. Do not commit.

## Client + auth

- `server-client.ts`: one `createClient` instance. Base URL: same origin when served by `perch serve`
  (static export at `/`), else `NEXT_PUBLIC_PERCH_URL` (dev: `next dev` on 3001 vs server on 4600).
  Token: the server sets an HttpOnly cookie when first opened with `?token=`; same-origin fetch
  sends it. For cross-origin dev, read `token` from the URL once, stash in sessionStorage, send
  as `Authorization: Bearer` via ClientOptions, and strip it from the URL. Check how
  packages/client's transport handles credentials/cookies and use it correctly.
- `workspace-source.ts`: decide live vs mock: `?mock=1` forces mock; otherwise probe
  `client.health()` with a 1.5s timeout on boot — live when it answers, mock (with a visible
  reason) when it does not. Expose `useAppWorkspace(): WorkspaceApi` that picks one. Keep the
  hook order stable (both providers' hooks must be called unconditionally or the choice must be
  made before the first render via useSyncExternalStore/lazy state — decide and document).

## Live provider behaviour (`live-workspace.tsx`)

- connections: GET on boot → Async; `connect(id, db)` → POST connect then select db;
  `selectDatabase`; `databases` from the summary or GET /databases; add/update/remove/test map to
  the routes; refresh the list after each mutation.
- schema: GET /schema?database= per (connection, database); `refreshSchema` uses `refresh=1`.
  Re-fetch automatically after any run whose statement `command` is DDL (CREATE/ALTER/DROP/…).
  Keep the mock's derived staleness pattern (different db → loading; same db → stale).
- settings: GET on boot; `updateSettings` PUT then replace; `roots` derived from settings.
- workspace files: `files.list(root)` for each root → merged tree (flat list per root is fine, the
  FilesList component decides); `refreshWorkspace`.
- buffers: `openFile` → files.read, remember `modifiedAt` per buffer (private map, not on the
  Buffer type); `save` → files.write with `ifModifiedAt`; on 409 (`staleWrite(err)`) set
  `saveState: "error"` AND put the disk copy on `buffer.conflict`; `resolveConflict("reload")`
  replaces content + modifiedAt, `("keep")` rewrites without ifModifiedAt then clears. Autosave:
  when `settings.autosave`, debounce `autosaveDelayMs` after the last edit of a dirty file buffer.
  `saveAs(id, path)` → files.create (dir + name) then write. Scratch buffers never touch disk.
  Format-on-save: another agent is adding `formatForSave(content, dialect, settings)` to
  `packages/sql` (export name may be `formatSql`); if it exists when you finish, call it in
  `save()` when `settings.formatOnSave`; if not, leave a clearly marked one-line hook.
- runs: `run(sql?)` → client-generated runId (crypto.randomUUID), `query.runSync`; while pending,
  keep a `running` RunRecord in `runs` so the UI shows the skeleton; replace with the returned
  record; `cancelRun` → runs.cancel. On boot, seed `runs` from GET /history?limit=50 (rows
  stripped; that is fine). Cap in-memory runs at 100.
- events: subscribe to `client.events()` once (AbortController on unmount, exponential
  reconnect 1s→10s): `file` change for an open clean buffer → re-read silently; for a dirty
  buffer → set `conflict` from a fresh read; `file` delete → mark the buffer scratch-like?
  No: keep the buffer, set `saveState` unchanged, and refresh the workspace listing. `roots`
  event → refresh settings + workspace. `run` event → ignore (we already have the record).
- errors: every action catches, maps to Async error / saveState "error"; nothing rejects
  except `testConnection` (contract says so).
- `source: "live"`.

## Verification (do it, then delete anything temporary)

Start the server: `cd apps/server && npm run build && PERCH_HOME=$(mktemp -d) node
dist/cli/main.js serve --port 4600 --no-open --dir /tmp/perch-ws` (create /tmp/perch-ws with a .sql
file first; add a connection with `node dist/cli/main.js conn add demo
postgres://sahil@localhost:5432/sqe_demo` under the same PERCH_HOME). Run
`cd apps/web && NEXT_PUBLIC_PERCH_URL=http://127.0.0.1:4600 npx next dev -p 3001` in the
background, open http://localhost:3001/?token=<token from $PERCH_HOME/server.json> with
headless Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new
--screenshot=... --window-size=1440,900 --virtual-time-budget=8000 <url>`) and confirm the
schema tree shows the demo tables. Also `cd apps/web && npx tsc --noEmit && npx eslint .` and
`bun run --filter @perch/client typecheck`. Kill both servers when done. No test files. Reply under
25 lines: files, decisions (auth, live/mock choice, conflict handling), verification.
