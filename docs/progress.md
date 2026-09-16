# Progress summary — 15 September 2026

What exists, how it got here, and what it was built from. Written for the team, so it stands
on its own without the chat history.

## The product in one paragraph

**perch** (package `perch`, binary `perch`) is a small SQL client for Postgres and MySQL,
replacing pgAdmin and MySQL Workbench for a small team. It is a local server started from the
command line that serves a web UI on a loopback port, not a bundled desktop app. It never
bundles a database: it finds the Postgres or MySQL already on the machine and offers to connect.
Files are plain `.sql` on disk under folders the user chooses.

## Decisions, in the order they were made

| Decision | Choice | Why |
| --- | --- | --- |
| Design first or code first | Four layout mockups before any app code | Choose by clicking, not arguing; `apps/mockups` was deleted once the merge shipped, and `docs/design/prototype-spec.md` is what survives of it |
| Desktop shell | Local CLI + web UI, not Electron/Tauri | No signing/packaging on three OSes; one artifact; Tauri wrapper still possible later because the UI is a pure HTTP client |
| Layout | A merge: classic three-pane chrome, resizable pane grid for editors and results, notebook as a view of a plain `.sql` file | Each region taken from whichever mockup did it best (`docs/design/prototype-spec.md`) |
| Auth | None | No auth: loopback binding is the boundary, by the user's decision |
| File sync | OS watchers + one Server-Sent Events stream + mtime check on save | VS Code's model; no polling, no WebSocket needed |
| Formatting | Explicit only: ⇧⌥F, right-click menu, command palette | Never rewrite SQL on save |
| Tests | None kept in the repo | Verification is done at build time with throwaway checks and the asserting smoke script |
| Package manager | bun workspaces | One lockfile, one install; server still runs and ships on Node |

## Repository layout

```
apps/server      perch — Hono API + perch CLI (5.5k lines)
apps/web         perch UI — Next static export, served by the server at /
packages/protocol  wire types only (types-only guard enforced)
packages/client    typed HTTP / NDJSON / SSE client over /api/*
packages/ui        the component library + workspace surfaces (10.7k lines)
packages/sql       statement splitter + formatter shared by the frontend
packages/tsconfig  shared compiler presets
docs/              architecture, API reference, design spec, mockups
```

Server internals are layered `cli → server → db → core`, with `storage/` shared and `util/` a
leaf; ESLint enforces the direction (`docs/architecture/server-structure.md`).

## What the server does (`perch`)

- Connections: add (URL or fields), list, test, connect, disconnect, remove, databases.
- **Discovery**: `perch discover` / `GET /api/discover` finds local servers via port probes,
  binaries on PATH and standard install dirs, Homebrew services, systemd, Windows services and
  Docker; parallel, ~0.5 s, 30 s memo.
- Schema introspection for Postgres and MySQL (tables, views, materialized views, columns, keys,
  row estimates), cached 30 s.
- Queries: multi-statement runs streamed as NDJSON, or one JSON reply; cancel; CSV/JSON export;
  errors with code and 0-based position; notices.
- Files: list, read, write with stale-write detection (409 with disk content), create, rename,
  delete, scoped to workspace folders with realpath checks; `.sql` only.
- Live sync: `GET /api/events` (SSE) with file change/delete, roots and run events; echo
  suppression for the server's own writes.
- History (JSONL), settings (JSON), all under `~/.perch` (`PERCH_HOME` overrides); first server
  start creates `~/.perch/queries` and adopts it as the workspace root.
- Install: one self-contained binary per platform (`bun build --compile`); not published to npm.
- Verification: `apps/server/scripts/smoke.sh` — 39 asserting checks against a local Postgres,
  the CI gate on Linux, Windows and macOS.

## What the UI does (`apps/web` + `packages/ui`)

- Topbar with connection/database picker, save indicator with autosave toggle, Run/Cancel, settings.
- Sidebar: schema tree (search, refresh), files, run history; resizable, collapsible.
- Editor: CodeMirror 6 with dialect-aware highlighting, schema-fed completion, error squiggles at
  the server-reported offset, run statement under cursor / selection / all, format document,
  right-click menu.
- Results: virtualized grid, Messages tab, statement strip for multi-statement runs, Grid/Text
  toggle, CSV export link, cancel.
- Pane grid: editors and results in resizable, rearrangeable panes.
- Notebook view of a plain `.sql` file (cells = statements or `-- %%` markers).
- Onboarding (first run): welcome → workspace folder → connection (with "Found on this
  machine") → database → done.
- Settings dialog: editor (keyword case), query (max rows, timeout), files (autosave, delay,
  workspaces), connections (list/test/edit/remove + discovery), appearance.
- Two providers behind one contract (`packages/ui/src/workspace/types.ts`): live (`@perch/client`)
  and fixtures. Live is chosen when the server answers `/api/health`; `?mock=1` forces fixtures.
- Motion: one spring and one fade (`packages/ui/src/lib/motion.ts`), reduced-motion respected.

## References used

- Component kit: a vendored set on Base UI (not Radix), Tailwind 4, Geist / Geist
  Mono, dark neutral tokens with one blue accent; its onboarding wizard, dialog, switch, select,
  field, label, radio-group and context-menu were ported.
- Static mockups: Claude Design canvas https://claude.ai/artifact/1GU8pGr3Po1a3RVo1ZEbXF and
  `docs/design/*.dc.html`.
- Briefs that produced the code: `docs/architecture/briefs/*` and `docs/design/briefs/*`.
- Libraries: Hono + @hono/node-server; pg + pg-cursor; mysql2; CodeMirror 6 (@codemirror/*,
  @lezer/highlight); sql-formatter; motion (v13); react-resizable-panels; @dnd-kit/core;
  @tanstack/react-virtual; lucide-react; Next 16; React 19; Tailwind 4; bun.
- Models borrowed: VS Code's external-file-change handling (OS watcher, reload if clean, conflict
  if dirty, mtime check on save).

## Known gaps

- MySQL driver is written and reviewed but has not run against a real MySQL server.
- Passwords are stored in a 0600 JSON file, not the OS keychain.
- Linux and Windows are covered by CI only; local runs were macOS.
- A dev-mode hydration warning from the pane grid was reported by its author; not seen in the
  shipped static build.
- Per-file write queue for concurrent saves from several tabs is designed, not built.
- Foreign keys are not introspected yet (blocks an ER view).
