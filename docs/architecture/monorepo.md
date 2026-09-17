# Monorepo architecture

One Bun workspaces repo, one lockfile, one `node_modules`. The product is a single binary
(`perch`, built by `bun build --compile`); everything else in here exists to keep what goes into
it small, honest and easy to change. `apps/server` is marked `private` — nothing here is
published to a registry, and distribution is a file you download.

```
perch/
├─ package.json            workspaces ["packages/*", "apps/*"]; scripts fan out (except lint)
├─ apps/server/            `perch` — the published package: Hono API + `perch` CLI
├─ apps/web/               @perch/web — the UI; static-exports into apps/server/ui/
├─ packages/protocol/      @perch/protocol — the wire contract, types only
├─ packages/client/        @perch/client — typed HTTP/NDJSON/SSE client over /api/*
├─ packages/ui/            @perch/ui — components + the workspace contract, raw .tsx
├─ packages/sql/           @perch/sql — SQL text utilities the frontend needs; mirrors apps/server
├─ packages/tsconfig/      @perch/tsconfig — base.json / node.json / react.json
├─ eslint.config.js        one ESLint config for the repo; apps/web pins its own
├─ turbo.json              Turborepo — one task, `dev`, so both halves start together
├─ scripts/dev.mjs         picks the API's dev port before handing off to turbo
└─ docs/architecture · docs/api · docs/design
```

Note what is _not_ at the root: no tsconfig. TypeScript presets live in `packages/tsconfig` and
are consumed by name (`extends: "@perch/tsconfig/node.json"`), so a package's compiler settings are
a normal dependency rather than an inheritance accident of where it happens to sit on disk. Five
workspaces extend them — the indirection buys something.

ESLint used to work the same way, as `@perch/eslint-config`. It doesn't any more. The config had
exactly one consumer (`apps/server`): `packages/protocol` and `packages/client` have no `lint`
script, and `apps/web` runs `eslint-config-next` on its own pinned ESLint 9. A package export
that one workspace imports is not a shared preset, it is a file with extra steps — a manifest, a
`peerDependencies` block and a workspace link standing in for a relative path. So the config sits
at the root now, and `serverLayering`'s globs name their target outright
(`apps/server/src/db/**`) instead of relying on the config file's position to scope them. If a
workspace ever needs a _different_ baseline, it gets its own `eslint.config.js` — the same escape
hatch `apps/web` already uses.

## Why each boundary exists

**`packages/protocol` — the contract, alone.** The shapes the server sends and receives are the
one thing the server, the CLI and every frontend must agree on. Putting them in their own
package means a change to the contract is a visible diff in one place, and means a frontend can
be typed against the server without importing any server code.

**`packages/client` — the only module that knows the server exists.** HTTP concerns (NDJSON
framing for `POST /api/query`, the SSE stream at `GET /api/events`, error envelopes) are written
once and tested once. A UI component never sees a `fetch`.

**`apps/server` — the product.** Layered internally (`cli → server → db → core`, with
`storage/` shared by `cli/` and `server/` and `util/` leaf) and documented in
[server-structure.md](server-structure.md).

**`apps/web` — the UI, and nothing else.** A Next 16 app that static-exports into
`apps/server/ui/`, so the single npm package carries both halves and there is no second artefact
to ship. It owns routing and the choice between the live provider and the fixtures; everything a
second surface might reuse lives in `packages/ui`, which may not import `@perch/client`.

## Dependency rules

```
@perch/protocol   →  nothing
@perch/sql        →  nothing
@perch/client     →  @perch/protocol
@perch/ui         →  @perch/protocol + @perch/sql
apps/server     →  @perch/protocol (devDependency, type-only)
apps/web        →  @perch/protocol + @perch/client + @perch/ui + @perch/sql
                   nothing depends on apps/server, and apps/server depends on no @perch/* at runtime
```

Two rules carry real weight.

**`@perch/sql` is a copy, on purpose.** The frontend needs the same statement boundaries the
server will use — for "run the statement under the cursor" and for notebook cells — but it cannot
import them. `apps/server` builds with plain `tsc` and carries five runtime dependencies, so
an `import { splitStatements } from "@perch/sql"` would survive into `dist/` and drag a private
workspace package into the shipped output. `@perch/protocol` escapes that only because types erase; a function does not.
Publishing a second package or switching the shipped artifact to a bundler both cost far more than
the 150 lines they would save. So `apps/server/src/core/sql/split.ts` stays the authority,
`packages/sql` holds a byte-identical copy, and `bun run --filter @perch/sql check` fails CI when the
two diverge (`--fix` re-syncs). A drifted copy would have the editor offer to run one range while
the server ran another, which is why this is enforced rather than remembered.

**Protocol is types only, and that is load-bearing.** Every export in `@perch/protocol` is a
`type`. TypeScript erases type-only imports entirely, so the package is consumed as raw `.ts`
source by both a NodeNext build (`apps/server`) and a bundler (`apps/web`) with no build step of
its own, and it never reaches a runtime bundle. That is also why `apps/server` can list it under
`devDependencies`: by the time `dist/` exists, nothing references it, so no `@perch/*` package has
to travel with the build. The shipped output's only runtime dependencies are `hono`,
`@hono/node-server`, `pg`, `pg-cursor` and `mysql2`.

The rule is enforced, not merely documented: `bun run --filter @perch/protocol check` runs
`scripts/assert-types-only.mjs`, which fails on any `export const | let | var | function | class |
enum | default` in `packages/protocol/src`. If you need a value — a default, a lookup table, a
type guard — it belongs to whoever owns the behaviour: `apps/server` or `@perch/client`.

**Nothing depends on `apps/server`.** The server is a leaf, not a library. A frontend that wants
something from it asks over HTTP through `@perch/client`; the types it needs are in the protocol
package. This is what keeps the UI honest about the fact that it is talking to a process over a
socket, and keeps the server free to restructure its internals — as it did in the restructure
that split `server/app.ts` into `create-server.ts` + `routes/*` + `services/*`, with no change
outside the workspace — without breaking anyone.

## How the frontend ships inside the server package

There is one artifact on npm. `apps/server/package.json` declares `files: ["dist", "ui",
"README.md"]`, and `createServer({ uiDir })` in
`apps/server/src/server/create-server.ts` passes `uiDir` down to
`apps/server/src/server/routes/ui.ts`, which mounts it as static assets with an SPA fallback to
`index.html`, registered last and behind `/api/*`. When `uiDir` is absent or missing on disk, `/`
serves a small placeholder page listing the API instead.

So the build chain is:

```
apps/web  →  static export  →  apps/server/ui/  →  packed into `perch`  →  served at /
```

`apps/server/ui/` is generated, and the root `.gitignore` ignores it. `perch serve --ui <dir>`
overrides the location, which is how you point a running server at a dev build.

## Toolchain

- **Bun workspaces**, `["packages/*", "apps/*"]` (the same `workspaces` field npm read). One
  `bun.lock` at the root; one `bun install` — `bun install --frozen-lockfile` in CI — installs
  everything. This is why no CI job uses `working-directory`.
- **Bun ≥ 1.2 installs and runs scripts; Node ≥ 22 runs the server.** The two are separate
  choices. `apps/server` declares `engines.node >=22`, imports `node:`
  builtins throughout and is launched as `node dist/cli/main.js`, so everything in CI that _runs_
  the CLI runs it on Node, across 22/24 and three OSes — under Bun it would be Bun being tested,
  not the artifact we ship. `typecheck`/`lint` are runtime-agnostic and go through Bun. Bun's
  other job here is unchanged: `bun build --compile` produces the single-file `perch` binary.
- **Scripts fan out** with `bun run --filter '*'`, which skips a workspace that lacks the script
  rather than breaking the run. Target one workspace with `--filter <name>`. `lint` is the one
  script that does not fan out — see the ESLint bullet below.
- **Turborepo owns `dev` and `start`, and nothing else.** `bun run dev` starts `next dev` on
  :3000 and the API on a free port, output prefixed per workspace. `bun run start` runs what
  `bun run build` produced — a single `perch serve`, since the built UI is a folder of static
  files the server mounts at `/` rather than a second process to supervise. The port is chosen by `scripts/dev.mjs`
  before turbo runs, because it is the one thing turbo cannot do: Next inlines `NEXT_PUBLIC_*` at
  compile time, so the UI has to be told where the server is _before_ it starts, and a port fixed
  in both scripts would collide with a real `perch serve`. The launcher picks a free port, passes
  it to the server as `PERCH_DEV_PORT` and to the bundle as `NEXT_PUBLIC_PERCH_URL`, and refuses to
  start at all when a server is already registered in `server.json` — `perch serve` would attach to
  that one and leave the UI pointed at nothing. Turbo 2 filters task environments, so both
  variables are declared in `passThroughEnv`. It is there for the
  _parallelism_ — two long-lived processes that have to agree on a port and an origin —
  not for the cache, which is why `turbo.json` declares a single `cache: false, persistent: true`
  task while `build`, `typecheck` and `lint` stay on bun's fan-out and CI never invokes turbo.
  Moving a build task in would mean thinking about cache keys for a repo whose full build takes
  seconds; the day that stops being true, that task list is where to start.
- **Shared tsconfig presets** in `@perch/tsconfig`: `base.json` holds the strictness everyone
  agrees on (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`,
  `noFallthroughCasesInSwitch`); `node.json` adds NodeNext resolution; `react.json` adds Bundler
  resolution, DOM libs and `jsx: preserve`. Nothing redefines strictness locally.
- **One ESLint config at the root.** `eslint.config.js` holds the TS baseline plus
  `serverLayering`, a set of `no-restricted-imports` patterns enforcing the server's import
  direction. Flat config resolves `files` globs against the directory holding the config file, so
  the repo-relative globs match only inside `apps/server` and behave identically whether ESLint
  runs from the root or from `apps/server`. `bun run lint` is therefore not a plain fan-out: it is
  one root run plus `apps/web`'s separate pass.
- **Versions are aligned across every package**: TypeScript 6 and ESLint 10 — with one
  documented exception. `apps/web` nests its own ESLint 9, because `eslint-config-next` bundles
  an `eslint-plugin-react` that still calls the `context.getFilename()` ESLint 10 removed. It has
  its own `eslint.config.mjs` and the root `lint` script invokes it separately, so ESLint never
  reaches the root config from inside it. `packages/ui` is plain React with no Next.js rules and is
  linted from the root on ESLint 10. A version skew between workspaces in a single `node_modules`
  is a debugging tax nobody should pay, so any future skew needs a comment saying why it exists.

## The verification gate

There is no test suite: the repo deliberately carries none — no `*.test.ts`, no test runner, no
`test` script in any workspace. Three workflows are what a change has to clear instead.

| Workflow       | What it runs                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server.yml`   | `typecheck`, `lint`, `build` and a CLI smoke (`--version`, `status`), on **Node** across 22/24 × ubuntu/windows/macos; then `apps/server/scripts/smoke.sh` against a Postgres service container |
| `packages.yml` | protocol `typecheck`, `bun run --filter @perch/protocol check` (the types-only guard), client `typecheck`                                                                                        |
| `web.yml`      | `lint`, `typecheck`, `build` for `apps/web`                                                                                                                                                      |

`scripts/smoke.sh` is **the only thing that exercises the HTTP API end to end** — it starts a real
server against a real Postgres, drives the routes and shuts it down. Everything else in the gate
is static. Treat it as load-bearing rather than as a nicety.

## How the mockups were dismantled

`apps/mockups` held four full layout directions — classic, notebook, split, focus — built on one
set of shared components so the layout decision could be made by clicking rather than by arguing.
It was `private`, never published, and nothing in `packages/` or `apps/server` was allowed to
depend on it. The decision went to a merge of all four rather than to any one of them, and the workspace was
deleted in a single pass:

1. **`apps/web` was scaffolded** — a Next 16 app on `@perch/tsconfig/react.json` with the same
   Tailwind and shadcn setup, and `web.yml` was pointed at it.
2. **The merged layout became `app/page.tsx`.** The four routes, `lib/directions.ts` and
   `components/workspace/direction-switcher.tsx` only ever existed to compare, and went with the
   workspace.
3. **The shared components graduated into `packages/ui`.** They were written against props
   rather than against a layout, which is what made four directions cheap in the first place and
   what makes them reusable now: `packages/ui` is typed against `@perch/protocol` alone, so
   `apps/web` composes them and a future surface can too. The shadcn primitives came along; the
   44 unused ones did not.
4. **`lib/mock/*` was replaced by `@perch/client`.** The mock provider was always the seam —
   everything above it consumed a connection, a schema tree, a file list and a run result — so
   swapping in a provider backed by real connections, the NDJSON run stream and the SSE event
   feed was the whole integration. The fixtures survive as `apps/web/lib/mock-workspace.tsx`,
   still implementing the same contract, and `?mock=1` picks them.
5. **Shipping was wired up.** `apps/web`'s static export lands in `apps/server/ui/`, and
   `apps/mockups` was deleted.

Nothing outside `docs/design/` refers to the directions any more; the spec is what survives of
them.
