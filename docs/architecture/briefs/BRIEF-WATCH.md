# External file change sync (VS Code-style), no polling

Context: read BRIEF-BACKEND.md, src/types.ts, src/server/files.ts, src/server/app.ts (roots come
from settings.workspaces + extraDirs, see `currentRoots`/`extraDirs` around line 217-230; file
routes at 484-560), src/server/start.ts, src/server/app.test.ts (test style with app.request()).

Goal: when a .sql file inside a workspace root changes on disk (another editor, git checkout,
rm/mv), connected UIs learn about it immediately over one long-lived Server-Sent Events stream.
Save conflicts keep using the existing `ifModifiedAt` → 409 check; the watcher is a hint, the
mtime check stays authoritative. No timers/polling for change detection.

## 1. src/server/watcher.ts — `class FileWatcher`

- `constructor(opts: { onEvent: (e: FileEvent) => void })`.
- `setRoots(roots: string[])`: diff against current roots; start `fs.watch(root, { recursive: true,
persistent: false })` (node:fs) for new roots, close watchers for removed ones. Roots are already
  realpath'd by files.ts helpers; reuse `resolveRoots`. `persistent: false` so the watcher never
  keeps the process alive. If `fs.watch` throws (unsupported FS, EMFILE), log once to stderr and
  continue without that root (never crash the server).
- Event handling: `fs.watch` gives `(eventType, filename)` with filename relative to root (may be
  null → ignore). Only care about paths where `isSqlFile(name)` OR directories (for `dir` events).
  Skip hidden entries (`isHidden`) and `SKIPPED_DIRS`. Because editors save via temp+rename, map to
  our own semantics by `fs.stat`-ing the path after the event: exists & file → `"change"` (with
  `modifiedAt`, `size`); exists & dir → `"dir"`; missing → `"delete"`. `eventType === "rename"` on
  an existing file also yields `"change"` (that's a create or an atomic save) — add `created: true`
  when we had not seen the path before in this watcher's lifetime (keep a Set of known paths,
  seeded lazily from the stat).
- Coalesce bursts: an editor save produces 2-4 raw events within a few ms. Buffer per path and
  flush with a single `setTimeout(…, 40)` per path (this is debounce of already-received events,
  not polling). Emit at most one event per path per burst, using the final stat.
- Echo suppression: `expectWrite(fullPath, modifiedAt: string)` — called by the server right
  after its own atomic write with the mtime it produced. If the next flushed event for that path
  has the same `modifiedAt`, drop it (and clear the expectation). Expectations expire after 2s so
  a lost event cannot poison a later real change. Also `expectDelete(fullPath)` for API deletes
  and renames.
- `close()` closes all watchers.
- Add to src/types.ts (additive):
  ```ts
  export type FileEvent =
    | {
        type: "change";
        path: string;
        name: string;
        modifiedAt: string;
        size: number;
        created?: boolean;
      }
    | { type: "delete"; path: string; name: string }
    | { type: "dir"; path: string; name: string; deleted?: boolean };
  export type ServerEvent =
    | { type: "hello"; serverStartedAt: string }
    | { type: "file"; event: FileEvent }
    | { type: "run"; runId: string; status: RunStatus }
    | { type: "roots"; roots: string[] };
  ```
- Unit tests `src/server/watcher.test.ts` on a temp dir (real fs.watch on macOS works): create a
  .sql → change/created; modify → change; atomic save (write tmp, rename over) → exactly one
  change; delete → delete; non-.sql file → nothing; hidden → nothing; expectWrite suppresses the
  echo; expectation expires. Use short waits (await a promise that resolves on the event, with a
  1.5s timeout) — no sleeps longer than needed. macOS FSEvents can be ~100ms late; allow that.

## 2. Events stream in app.ts

- `GET /api/events` (auth like other /api routes): SSE via `hono/streaming` `streamSSE`.
  On connect send `hello`, then `roots` (current roots). Then forward every ServerEvent as
  `event: <type>` + `data: <json>`, and a `: ping` comment every 25s to keep proxies/browsers from
  dropping the connection (that is keep-alive, not polling; acceptable). Clean up the listener
  on abort.
- Introduce a tiny in-process `EventBus` (src/server/events.ts: `on/off/emit` typed on
  ServerEvent, plus `subscribe(fn): () => void`). `createApp` creates one (or accepts one via opts
  for tests) and wires: FileWatcher.onEvent → bus `file`; registry run finish → bus `run`
  (registry gets an optional `onRunFinished` hook — additive); settings PUT that changes
  workspaces → watcher.setRoots + bus `roots`.
- Echo suppression hooks: after PUT /api/files/content, POST /api/files (create), rename (expect
  delete of old + write of new), DELETE → call the corresponding expect* with the mtime returned
  by `writeFileAtomic` (it returns modifiedAt; check).
- Watcher lifecycle: created in `createApp` when `opts.watch !== false` (tests pass `watch:false`
  unless testing it); roots set on startup from `currentRoots()`; `app` exposes `close()` via a
  returned handle — simplest: `createApp` keeps returning Hono but ALSO attach
  `app.__close = async () => …`? No: instead export `createApp` returning `{ app, close, bus }`?
  That would break existing callers (start.ts, tests). Keep `createApp(opts): Hono` and add a
  second export `createServer(opts): { app: Hono; bus: EventBus; watcher: FileWatcher | null;
close(): Promise<void> }` that `createApp` delegates to; update start.ts to use `createServer`
  and close the watcher on shutdown.
- `GET /api/files/content` response: unchanged. `PUT` 409 body: make sure it includes the current
  `modifiedAt` and, if small (< 512 KB), the current `content`, so the UI can show a diff without
  a second request. Adjust the existing test if the shape grows (additive fields only).
- Tests in app.test.ts: `/api/events` requires auth; first two SSE frames are hello and roots;
  a bus.emit({type:"file",…}) shows up as a frame; PUT then an injected watcher event with the
  same mtime is suppressed (use a FileWatcher on a temp root in that one test, or unit-test the
  suppression in watcher.test.ts and here only test bus → SSE plumbing).

## 3. README.md

Add a short "Live file sync" section: how it works (OS watchers via fs.watch, SSE at
/api/events, mtime check on save), the event shapes, a curl example
(`curl -N -H "Authorization: Bearer $T" http://127.0.0.1:4600/api/events`), and the caveats
(atomic-save editors show as change with created flag; watchers may coalesce; save check is
authoritative).

Definition of done: `npm run typecheck`, `npm run lint`, `npm test` clean (run the whole suite).
Do not change existing exported signatures; only add. Reply under 25 lines.
