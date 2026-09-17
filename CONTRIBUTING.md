# Contributing

Thanks for taking a look. This is a Bun workspaces monorepo: one lockfile, one `node_modules`,
and a single shipped artefact: the `perch` binary. Everything else exists to keep what goes into
it small and easy to change.

## Setup

Bun 1.2+ installs and runs the scripts; the server itself targets Node 22+ (see `.nvmrc`).
Install once, at the repo root:

```sh
bun install        # installs every workspace
bun run dev        # both halves: the UI on :3000, the API on a fresh port
```

> **Never run an install or add a dependency inside `apps/*` or `packages/*`.** It creates a
> nested lockfile and a second copy of React or TypeScript. Add the dependency to that
> workspace's `package.json` and install at the root.

`dev` runs `perch serve` and `next dev` together through Turborepo, prefixing each line with the
workspace it came from. The UI keeps Next's usual :3000; the API takes a free port picked at
startup, so it never argues with a real `perch serve` you have running, or with a second clone.
Open the `dev UI` line:

```
perch:dev: perch v0.1.0 → http://127.0.0.1:54716
perch:dev: dev UI      → http://localhost:3000/
perch:dev: dev UI      → http://localhost:3001/
@perch/web:dev:   ▲ Next.js 16.3.2  - Local: http://localhost:3000
```

The UI and the API are on different origins in dev, so the browser only reaches the API because
the server's dev script allows both through CORS — that is what the `dev UI` lines are. Both
:3000 and :3001 are printed; take the one `next dev` actually bound, which it prints on its own
line.

Because the API port changes per run, a tab left open from a previous session points at a port
that is gone — reload it from the fresh URL. To pin the port instead, set `PERCH_DEV_PORT=4600`.

`dev:server` and `dev:ui` run one half each, skipping the launcher; both then default to :4600 —
the server's `--port ${PERCH_DEV_PORT:-4600}` and `apps/web/.env.development` agree on that number
so the halves still find each other. Note that `next dev` refuses to start a second server for the
same directory, so stop any `next dev` you already have running for `apps/web` first.

## Repo map

```
perch/
├─ apps/server/        the product: Hono API + `perch` CLI, compiled into the shipped binary
├─ apps/web/           @perch/web — the UI (Next 16), static-exported into apps/server/ui/
├─ packages/protocol/  @perch/protocol — the wire contract. Types only, no build step.
├─ packages/client/    @perch/client — typed HTTP/NDJSON/SSE client over /api/*
├─ packages/ui/        @perch/ui — components + the workspace contract, shipped as raw .tsx
├─ packages/sql/       @perch/sql — statement splitter + formatter the frontend needs
├─ packages/tsconfig/  @perch/tsconfig — base / node / react presets
├─ eslint.config.js    one ESLint config for the repo (apps/web pins its own)
├─ turbo.json          Turborepo tasks — `dev` and `start`; everything else fans out directly
├─ scripts/dev.mjs     picks the API's port, then hands both halves to turbo
└─ docs/               architecture/, api/, design/
```

## Scripts

Run these from the repo root as `bun run <script>`. The fan-out ones use `--filter '*'`, so a
workspace that does not define the script is skipped rather than failing the run.

| Script            | What it does                                                                      |
| ----------------- | --------------------------------------------------------------------------------- |
| `dev`             | both halves: `next dev` on :3000 + `perch serve` on a free port (scripts/dev.mjs) |
| `dev:server`      | just the server (`perch serve --no-open` on :4600, from TypeScript)               |
| `dev:ui`          | just the UI (`next dev` on :3000, expects the API on :4600)                       |
| `build`           | builds every workspace that has a build                                           |
| `start`           | runs the built app: `perch serve` on :4600, serving the built UI and the API      |
| `typecheck`       | `tsc --noEmit` across every workspace                                             |
| `lint`            | ESLint over apps/server and packages/ui, then apps/web's own ESLint 9 pass        |
| `smoke`           | end-to-end smoke against a local Postgres (apps/server/scripts/smoke.sh)          |
| `perch -- <args>` | runs the `perch` binary from the server workspace (needs a build)                 |
| `clean`           | removes node_modules and all build output                                         |

To target a single workspace, use `--filter`: `bun run --filter perch typecheck`,
`bun run --filter @perch/web lint`, `bun run --filter @perch/protocol check`.

**Node 22+ is still a supported target.** Dev and the shipped binary both run on Bun, but
`apps/server` declares `engines.node >=22`, points `bin` at `dist/cli/main.js` and runs `start` as
`node dist/cli/main.js`. Nothing exercises that path day to day (CI is commented out while the
repo is private), so check a change that touches process, fs, net or crypto with
`bun run --filter perch build && bun run --filter perch start`.

## Where things go

- **A wire type** (anything the server sends or receives) → `packages/protocol`. Types only:
  a runtime export there fails `bun run --filter @perch/protocol check`, because the package is
  consumed as raw `.ts` and is erased at compile time so the published package carries no scoped
  dependency. Server-internal types (the `Driver` interface, `ConnectionPoolOptions`, `RouteDeps`)
  stay next to their implementation.
- **Anything that calls the API from a browser** → `packages/client`. Frontends import
  `@perch/protocol` + `@perch/client` and nothing else from the repo. Nothing depends on
  `apps/server`.
- **Server, driver or CLI logic** → `apps/server/src`, respecting the layering
  (`cli → server → db → core`, with `storage/` shared by `cli/` and `server/`, and `util/`
  leaf-level). ESLint enforces the import direction and will fail you. See
  [docs/architecture/server-structure.md](docs/architecture/server-structure.md).
- **UI** → `apps/web` for anything app-shaped (routing, the provider that picks live data
  vs fixtures), `packages/ui` for anything a second surface could reuse. No component in
  `packages/ui` may import `@perch/client`; `apps/web/lib` is the only place that does.

The frontend does not ship separately: `apps/web` builds its static output into `apps/server/ui/`
(gitignored), and the single `perch` binary carries both halves.

TypeScript presets live in `packages/tsconfig` and are extended by name — do not add a root
`tsconfig.json`. ESLint config lives at the repo root and covers every ESLint 10 workspace;
`apps/web` keeps its own next to it for its pinned ESLint 9.

## What a change has to clear

**There is no test suite — the repo deliberately carries none.** The gate is:

1. `typecheck` + `lint` once, then `build` plus a CLI smoke on the Node 22/24 × Linux/Windows
   matrix (`.github/workflows/server.yml`)
2. the protocol types-only guard and package typechecks (`.github/workflows/packages.yml`)
3. lint/typecheck/build for `apps/web` (`.github/workflows/web.yml`)
4. `apps/server/scripts/smoke.sh` against a real Postgres — the only end-to-end exercise of the
   HTTP API, so it is load-bearing rather than a nicety. Please don't remove it.

Run the first three locally before opening a PR:

```sh
bun run typecheck && bun run lint && bun run build
```

The reasoning behind each boundary is in
[docs/architecture/monorepo.md](docs/architecture/monorepo.md); read it before moving anything
between workspaces.
