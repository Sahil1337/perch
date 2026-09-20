# Contributing

Thanks for taking a look. This is a Bun workspaces monorepo: one lockfile, one `node_modules`,
and a single shipped artefact: the `perch` binary. Everything else exists to keep what goes into
it small and easy to change.

Two toolchains, cleanly split. **The server is Go**; the UI and the shared packages are
TypeScript on Bun. They meet in exactly two places: the HTTP contract, and the web bundle the
binary embeds.

## Setup

Bun 1.2+ installs and runs the scripts; **Go 1.25+ builds the server**. The Go module has no npm
dependencies, so `bun install` never touches it. Install once, at the repo root:

```sh
bun install        # installs every workspace
bun run dev        # both halves: the UI on :5173, the API on a fresh port
```

> **Never run an install or add a dependency inside `apps/*` or `packages/*`.** It creates a
> nested lockfile and a second copy of React or TypeScript. Add the dependency to that
> workspace's `package.json` and install at the root.

`dev` runs the server (`go run .`) and `vite dev` together through Turborepo, prefixing each line
with the workspace it came from. The UI keeps Vite's usual :5173; the API takes a free port picked at
startup, so it never argues with a real `perch serve` you have running, or with a second clone.
Open the `dev UI` line:

```
perch:dev: perch v0.1.0 → http://127.0.0.1:54716
perch:dev: dev UI      → http://localhost:5173/
perch:dev: dev UI      → http://127.0.0.1:5173/
@perch/web:dev:   VITE v8.3.0  ready in 430 ms
@perch/web:dev:   ➜  Local:   http://localhost:5173/
```

The UI and the API are on different origins in dev, so the browser only reaches the API because
the server's dev script allows both through CORS — that is what the `dev UI` lines are. Vite's
port is pinned (`strictPort`) rather than left to walk to the next free one, because that list of
allowed origins is fixed: a UI on some other port would fail in the browser, not in the terminal.

Because the API port changes per run, a tab left open from a previous session points at a port
that is gone — reload it from the fresh URL. To pin the port instead, set `PERCH_DEV_PORT=4600`.

`dev:server` and `dev:ui` run one half each, skipping the launcher; both then default to :4600 —
the server's `--port ${PERCH_DEV_PORT:-4600}` and `apps/web/.env.development` agree on that number
so the halves still find each other. `vite dev` exits rather than pick another port if :5173 is
taken, so stop any dev UI you already have running first.

## Repo map

```
perch/
├─ apps/server/        the product: Go HTTP API + `perch` CLI, compiled into the shipped binary
├─ apps/web/           @perch/web — the UI (TanStack Start, SPA mode), built into apps/server/ui/
├─ packages/protocol/  @perch/protocol — the wire contract. Types only, no build step.
├─ packages/client/    @perch/client — typed HTTP/NDJSON/SSE client over /api/*
├─ packages/ui/        @perch/ui — components + the workspace contract, shipped as raw .tsx
├─ packages/sql/       @perch/sql — statement splitter + formatter the frontend needs
├─ packages/tsconfig/  @perch/tsconfig — base / node / react presets
├─ eslint.config.js    one ESLint config for the repo, every workspace                      
├─ turbo.json          Turborepo tasks — `dev` and `start`; everything else fans out directly
├─ scripts/dev.mjs     picks the API's port, then hands both halves to turbo
└─ docs/               architecture/, api/, design/
```

## Scripts

Run these from the repo root as `bun run <script>`. The fan-out ones use `--filter '*'`, so a
workspace that does not define the script is skipped rather than failing the run.

| Script            | What it does                                                                      |
| ----------------- | --------------------------------------------------------------------------------- |
| `dev`             | both halves: `vite dev` on :5173 + `perch serve` on a free port (scripts/dev.mjs) |
| `dev:server`      | just the server (`go run . serve --no-open` on :4600)                             |
| `dev:ui`          | just the UI (`vite dev` on :5173, expects the API on :4600)                       |
| `build`           | `@perch/web` then `perch`, in that order — the binary embeds the web bundle       |
| `start`           | runs the built app: `perch serve` on :4600, serving the built UI and the API      |
| `typecheck`       | `tsc --noEmit` across the TypeScript workspaces; `go build ./...` for the server  |
| `lint`            | one ESLint run over apps/web and packages/ui, then `go vet` in apps/server        |
| `smoke`           | end-to-end smoke against a local Postgres; drives the built binary, so build first |
| `perch -- <args>` | runs the `perch` binary from the server workspace (needs a build)                 |
| `clean`           | removes node_modules and all build output                                         |

To target a single workspace, use `--filter`: `bun run --filter perch typecheck`,
`bun run --filter @perch/web lint`, `bun run --filter @perch/protocol check`.

**The server needs Go 1.25+, and nothing else does.** `apps/server` is a Go module; its
`package.json` holds scripts and no dependencies, so `bun install` never touches it. Its real
entry points are `scripts/build.sh` (add `--all` to cross-compile every release target) and
`scripts/dev.sh`. `go vet ./...`, `gofmt -l .` and `go build ./...` are what CI runs, so run them
before pushing:

```sh
cd apps/server && gofmt -l . && go vet ./... && go build ./...
```

## Where things go

- **A wire type** (anything the server sends or receives) → `packages/protocol`. Types only:
  a runtime export there fails `bun run --filter @perch/protocol check`, because the package is
  consumed as raw `.ts` and is erased at compile time so the published package carries no scoped
  dependency. Add the Go counterpart in `apps/server/protocol` in the same change — the two
  halves of the contract are kept in step by hand. Server-internal types (the `Driver` interface,
  the pool's entry type) stay next to their implementation and never appear in either.
- **Anything that calls the API from a browser** → `packages/client`. Frontends import
  `@perch/protocol` + `@perch/client` and nothing else from the repo. Nothing depends on
  `apps/server`.
- **Server, driver or CLI logic** → `apps/server`, in Go. The direction is `main → server → db`
  with `storage/` shared; the rule that matters is that `db/` must not import `server/`, so
  drivers return plain errors and `server/pool.go` turns them into HTTP ones. See
  [docs/architecture/server-structure.md](docs/architecture/server-structure.md).
- **UI** → `apps/web` for anything app-shaped (routing, the provider that picks live data
  vs fixtures), `packages/ui` for anything a second surface could reuse. No component in
  `packages/ui` may import `@perch/client`; `apps/web/src/lib` is the only place that does.

The frontend does not ship separately: `apps/web` builds its static output into `apps/server/ui/`,
`scripts/build.sh` stages that into `apps/server/webui/static/`, and `//go:embed` compiles it into
the binary. Both directories are build output and gitignored.

TypeScript presets live in `packages/tsconfig` and are extended by name — do not add a root
`tsconfig.json`. ESLint config lives at the repo root and covers every TypeScript workspace in one
run; the server is linted by `go vet` instead.

## What a change has to clear

**There is no test suite — the repo deliberately carries none.** The gate is:

1. for the server: `gofmt`, `go vet`, `go build`, a CLI smoke on Linux/macOS/Windows, and a
   cross-compile of all five release targets (`.github/workflows/server.yml`). That last job
   exists to fail the moment a dependency stops being pure Go, because `CGO_ENABLED=0` is what
   lets one machine build every platform.
2. the protocol types-only guard and package typechecks (`.github/workflows/packages.yml`)
3. lint/typecheck/build for `apps/web` (`.github/workflows/web.yml`)
4. `apps/server/scripts/smoke.sh` against a real Postgres — the only end-to-end exercise of the
   HTTP API, so it is load-bearing rather than a nicety. Please don't remove it.

Run the first three locally before opening a PR:

```sh
bun run typecheck && bun run lint && bun run build
```

`lint` and `typecheck` already reach the Go module (`go vet ./...` and `go build ./...`), but
`gofmt` is only checked in CI, so run it yourself after touching Go:

```sh
cd apps/server && gofmt -l .        # prints nothing when clean
```

## Cutting a release

The version in `apps/server/package.json` is the source of truth; the workflow fails if the tag
disagrees with it, because the binary reports its version from a build flag and would otherwise
lie about which release it is.

```sh
# bump apps/server/package.json, commit, then:
git tag v0.1.0 && git push origin v0.1.0
# wait for that commit's `server` workflow to pass, then:
#   Actions -> release -> Run workflow -> tag: v0.1.0
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) is **manual only**, and that is
the point: it re-runs no checks, so a push trigger would let a red commit ship by accident.
Running it by hand means you have looked at the tick. `go build` still blocks anything that does
not compile, but a behavioural regression compiles fine — the smoke suite is what catches those,
and it does not run here.

It builds all five targets, ships Windows as a bare `.exe` and the rest as `.tar.gz` (the tarball
is what preserves the executable bit; a raw download needs a `chmod`), writes `checksums.txt`,
and opens a **draft** release for you to publish. Re-running against an existing tag re-uploads
the assets rather than failing.

Publishing is what makes a release exist for everyone else: `install.sh` and `perch update` both
read `releases/latest`, which does not see a draft. Until you publish, `perch update` on an older
binary reports the previous release as the newest one.

The binaries are unsigned. Until there is an Apple Developer certificate and a Windows signing
cert, a downloaded copy trips Gatekeeper on macOS and SmartScreen on Windows.

The reasoning behind each boundary is in
[docs/architecture/monorepo.md](docs/architecture/monorepo.md); read it before moving anything
between workspaces.
