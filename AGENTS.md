# Conventions for agents

Conventions for any AI agent or coding tool working in this repo. This is the canonical file —
`CLAUDE.md` points here rather than repeating it, so edit this one.

Read [docs/architecture/monorepo.md](docs/architecture/monorepo.md) before moving anything
between workspaces. [CONTRIBUTING.md](CONTRIBUTING.md) has the repo map and the script table.

**[README.md](README.md) is project-facing** — what `perch` is, install, usage, security. Setup,
scripts, layering and CI belong in `CONTRIBUTING.md`. Do not move dev instructions back into the
README.

## Commands

Run everything from the repo root. There is one `bun.lock` and one `node_modules`.

- **Never** run an install or add a dependency inside `apps/*` or `packages/*` — it creates a
  nested lockfile and a second copy of React or TypeScript. Add the dependency to that
  workspace's `package.json` and install at the root.
- `build` is ordered, not fanned out: `@perch/web` first, then `perch`, because the binary embeds
  the web bundle. `typecheck` fans out (`--filter '*'`, which skips a workspace that lacks the
  script); for the Go server it is `go build ./...`. `lint` is one root ESLint run over
  `apps/web/src` and `packages/ui/src`, then `go vet ./...` in `apps/server`.
- Target one workspace with `--filter`: `bun run --filter perch typecheck`,
  `bun run --filter @perch/web build`, `bun run --filter @perch/protocol check`.
  `bun run perch -- <args>` drives the CLI (the workspace bin, so it needs a `build` first).
- **Turborepo owns `dev` and `start`, nothing else.** `dev` starts `vite dev` (:5173, pinned with
  `strictPort` because apps/server's dev script allow-lists that exact origin) and `perch serve`
  (a free port, picked by `scripts/dev.mjs` and passed to both through `PERCH_DEV_PORT` /
  `VITE_PERCH_URL`); `dev:server` and `dev:ui` are the halves, both on :4600. `start` runs the
  built app, which is one process: there is no production UI server, because `apps/web` builds
  into `apps/server/ui/` and `perch serve` mounts it at `/`.
  **Turbo 2 filters the environment** — a new variable either half needs must be added to
  `passThroughEnv` in `turbo.json` or it silently will not arrive. Don't move another task into
  turbo without a reason to want its cache.
- **The server is Go**; everything else is TypeScript on Bun. It needs Go 1.25+ and no Node at
  all. `apps/server/package.json` exists only so turbo and `--filter perch` keep working: every
  script in it shells out to `scripts/*.sh`, and the module has no npm dependencies.
- **Keep `CGO_ENABLED=0`.** Every Go dependency is pure Go, which is the only reason one machine
  cross-compiles all five release targets. A cgo dependency would cost that, so adding one is a
  decision, not a detail. CI's `cross-compile` job is what catches it.
- **ESLint config lives at the repo root** (`eslint.config.js`) and covers every workspace in one
  ESLint 10 run; no workspace nests its own any more. Do not add a root `tsconfig.json` — tsconfig
  presets still live in `@perch/tsconfig` and are extended by name.

## Code

- **`apps/server/protocol` and `@perch/protocol` are the same contract, twice.** The Go structs
  are what the server marshals; the TypeScript is what the UI parses. They are kept in step by
  hand, so a change to a wire type is a change to both files. The Go package doc lists the three
  places Go's JSON defaults differ from TypeScript's.
- **`@perch/protocol` is types only.** Every export must be a `type`. A `const`, `function`,
  `class` or `enum` there fails `bun run --filter @perch/protocol check`
  (`scripts/assert-types-only.mjs`),
  because the package is consumed as raw `.ts` and erased at compile time — that is what keeps
  the published package free of scoped dependencies. Values belong to `apps/server`
  or `@perch/client`.
- **Anything that crosses the wire goes in `@perch/protocol`.** Server-internal types (the `Driver`
  interface, `ConnectionPoolOptions`, `RouteDeps`) stay next to their implementation.
- **Import direction inside `apps/server`** — `main → server → db`, with `storage/` (on-disk
  state) shared, and `protocol/`, `httpx/`, `fsx/`, `sqlscript/` leaf-level. `db/` must not import
  `server/`: the HTTP error envelope is the server's, which is why the driver layer returns plain
  errors and `server/pool.go` is the seam that turns them into answerable failures. Go's compiler
  rejects an import cycle, which covers most of this for free; the rest is convention. The tree is
  in `docs/architecture/server-structure.md`.
- **Nothing depends on `apps/server`.** Frontends talk to it over HTTP through `@perch/client`.
- `apps/server/ui/` is build output (the frontend bundle the package ships); it is gitignored.

## Frontend structure

Read this before adding to or writing a new component in `apps/web` or `packages/ui`.

- **One component (or one small, tightly-related family) per file.** If a file is accumulating
  components that don't share state or aren't always rendered together, split it before adding to
  it rather than after. `packages/ui/src/ui/` is the exception: vendored shadcn/Base UI primitives
  stay one file per primitive even at 250-300 lines — that's the upstream shape, and splitting it
  fights future updates from upstream.
- **Don't store what can be derived.** No `useState` for a value that's a pure function of props or
  other state — compute it inline or with `useMemo`. No `useEffect` that copies one piece of state
  into another; that's almost always two names for the same value drifting out of sync. Push state
  down to the component that owns it; lift only what's actually shared by siblings.
- **Tailwind first, enforced.** `@shadcn/lint` (`shadcn/no-raw-colors`, `no-arbitrary-values`,
  `no-inline-styles`, `no-unknown-classes`, `no-restyle`) fails `bun run lint` on hand-rolled CSS,
  raw color values, or arbitrary Tailwind values — use theme tokens and real utility classes. Plain
  CSS is only for what Tailwind can't express (keyframes). See the comment at the top of
  `eslint.config.js`.
- **Match the existing folder idiom per feature; don't force one shape everywhere.** Co-located
  single files at one level (like `packages/ui/src/ui/`) for a flat set of primitives, or a feature
  subfolder with an index/barrel when a component genuinely decomposes into a family of parts. When
  you split a file into a folder, re-export from the original path so other files' imports don't
  all need to change.

## Verifying a change

**The repo carries no test suite, and none gets committed.** The gate is
typecheck + lint + build + a CLI smoke on the OS matrix, plus `apps/server/scripts/smoke.sh`
against a real Postgres, which is the only end-to-end exercise of the HTTP API. Do not remove it.
It drives the compiled binary, so `bun run --filter perch build` has to run first. See
`docs/architecture/monorepo.md`.

Before handing work back, run:

```sh
bun run typecheck && bun run lint && bun run build
```

Writing a throwaway test to verify your own work is fine — run it, then delete it. What must not
land is a committed `*.test.ts`.

## Project facts that trip people up

- **It is perch all the way down.** Product, package, binary, internal scopes (`@perch/*`), env
  vars (`PERCH_HOME`, `PERCH_DEV_PORT`, `PERCH_SMOKE_PG`) and the on-disk home: `~/.perch` holds
  connections.json, settings.json, history.db, server.json and `queries/`, the default
  workspace — **nothing perch writes belongs anywhere else**. The earlier `sql-engine` / `sqe`
  names are gone; if you find one, it is a leftover, not a convention.
- **Nothing is published to a registry.** `apps/server` is `private` and distribution is a single
  self-contained binary (`scripts/build.sh --all`, one per platform).
  `.github/workflows/release.yml` is **manual only** (Actions -> release -> Run workflow, with a
  tag): it builds all five targets, ships Windows as a bare `.exe` and the rest as tarballs with
  `LICENSE`/`README.md`, checksums them, and opens a **draft** release. It re-checks nothing, so
  run it only against a tag whose `server` workflow is green — being manual is what makes that
  enforceable. The binaries are unsigned, so macOS needs notarization and Windows a cert before
  anyone can download them without a warning.
- **`install.sh`, `apps/server/update/` and the release workflow are coupled.** The installer and
  `perch update` both build the asset name (`perch-<version>-<os>-<arch>.tar.gz`, a bare `.exe`
  on Windows) and read `checksums.txt`; changing how `release.yml` names or packages assets
  breaks `curl … | sh` for everyone and `perch update` for everyone already on an older binary,
  which no later release can fix. Change all three, and test both against a local directory with
  `PERCH_DOWNLOAD_BASE=file:///path` — `update` speaks `file://` for exactly that.
  Never add an `npm i -g` line to docs — there is no package to install, and the npm names
  `perch`, `sqe` and `sql-engine` all belong to unrelated projects.
- **The frontend is `apps/web`.** The four layout directions in `apps/mockups` did their job
  and were deleted; the components they shared now live in `packages/ui`. `apps/web` is TanStack
  Start in SPA mode: `vite build` prerenders one shell, `scripts/postbuild.mjs` copies
  `dist/client/` into `apps/server/ui/`, and that is how the one binary carries both halves. The
  copied tree must keep `index.html` at its root — `apps/server/server/ui.go` returns that file
  for every unmatched non-`/api/` GET. `scripts/build.sh` then stages `apps/server/ui/` into
  `apps/server/webui/static/`, which is the directory `//go:embed` reads. Both are build output
  and gitignored; `webui/static/.gitkeep` is committed because the embed needs the directory to
  exist in a clean checkout.
- **MIT licensed.** New workspaces inherit it; `apps/server` keeps its own `LICENSE` copy so the
  shipped half of the repo carries its licence next to it.

## Don't touch

- `apps/web/src/routeTree.gen.ts` — the TanStack Router plugin rewrites it on every `vite dev`
  and `vite build`. It is committed so `typecheck` works from a clean checkout without a build
  first; if it turns up dirty, commit it alongside your work rather than reverting it.
