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
- `build`, `typecheck` and `lint` fan out to every workspace (`--filter '*'`, which skips a
  workspace that lacks the script). `lint` is the exception: one root ESLint run over
  `apps/server/src` and `packages/ui/src`, then `bun run --filter @perch/web lint` for the Next
  app's pinned ESLint 9.
- Target one workspace with `--filter`: `bun run --filter perch typecheck`,
  `bun run --filter @perch/web lint`, `bun run --filter @perch/protocol check`.
  `bun run perch -- <args>` drives the CLI (the workspace bin, so it needs a `build` first).
- **Turborepo owns `dev` and `start`, nothing else.** `dev` starts `next dev` (:3000) and
  `perch serve` (a free port, picked by `scripts/dev.mjs` and passed to both through
  `PERCH_DEV_PORT` / `NEXT_PUBLIC_PERCH_URL`); `dev:server` and `dev:ui` are the halves, both on
  :4600. `start` runs the built app, which is one process: there is no production UI server,
  because `apps/web` static-exports into `apps/server/ui/` and `perch serve` mounts it at `/`.
  **Turbo 2 filters the environment** — a new variable either half needs must be added to
  `passThroughEnv` in `turbo.json` or it silently will not arrive. Don't move another task into
  turbo without a reason to want its cache.
- **Don't break Node.** The server runs on Bun in dev and ships as a Bun binary, but Node 22+ is
  still a supported target: see [CONTRIBUTING.md](CONTRIBUTING.md#scripts) before touching
  process, fs, net or crypto behaviour.
- **ESLint config lives at the repo root** (`eslint.config.js`) and covers every ESLint 10
  workspace. `apps/web` keeps its own next to it; see the comment at the top of the root
  config for why. Do not add a root `tsconfig.json` — tsconfig presets still live in
  `@perch/tsconfig` and are extended by name.

## Code

- **`@perch/protocol` is types only.** Every export must be a `type`. A `const`, `function`,
  `class` or `enum` there fails `bun run --filter @perch/protocol check`
  (`scripts/assert-types-only.mjs`),
  because the package is consumed as raw `.ts` and erased at compile time — that is what keeps
  the published package free of scoped dependencies. Values belong to `apps/server`
  or `@perch/client`.
- **Anything that crosses the wire goes in `@perch/protocol`.** Server-internal types (the `Driver`
  interface, `ConnectionPoolOptions`, `RouteDeps`) stay next to their implementation.
- **Import direction inside `apps/server`** — `cli → server → db → core`, with `storage/`
  (on-disk state) shared by `cli/` and `server/`, and `util/` leaf-level. `core/` imports no other
  layer; `db/` and `storage/` may import only `core/` and `util/`; `server/` may not import `cli/`
  (shared helpers go in `src/util/`); `util/` imports nothing. Nothing in `apps/server` may import
  `@perch/client`. ESLint enforces all of this via `serverLayering` in the root `eslint.config.js` —
  it will fail you. The tree itself is in `docs/architecture/server-structure.md`.
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
  `eslint.config.js` / `apps/web/eslint.config.mjs`.
- **Match the existing folder idiom per feature; don't force one shape everywhere.** Co-located
  single files at one level (like `packages/ui/src/ui/`) for a flat set of primitives, or a feature
  subfolder with an index/barrel when a component genuinely decomposes into a family of parts. When
  you split a file into a folder, re-export from the original path so other files' imports don't
  all need to change.

## Verifying a change

**The repo carries no test suite, and none gets committed.** The gate is
typecheck + lint + build + a CLI smoke on the Node/OS matrix, plus
`apps/server/scripts/smoke.sh` against a real Postgres, which is the only end-to-end exercise of
the HTTP API. Do not remove it. See `docs/architecture/monorepo.md`.

Before handing work back, run:

```sh
bun run typecheck && bun run lint && bun run build
```

Writing a throwaway test to verify your own work is fine — run it, then delete it. What must not
land is a committed `*.test.ts`.

## Project facts that trip people up

- **It is perch all the way down.** Product, package, binary, internal scopes (`@perch/*`), env
  vars (`PERCH_HOME`, `PERCH_DEV_PORT`, `PERCH_SMOKE_PG`) and the on-disk home: `~/.perch` holds
  connections.json, settings.json, history.jsonl, server.json and `queries/`, the default
  workspace — **nothing perch writes belongs anywhere else**. The earlier `sql-engine` / `sqe`
  names are gone; if you find one, it is a leftover, not a convention.
- **Nothing is published to a registry.** `apps/server` is `private` and distribution is a single
  self-contained binary (`bun build --compile`, one per platform, attached to a GitHub release).
  Never add an `npm i -g` line to docs — there is no package to install, and the npm names
  `perch`, `sqe` and `sql-engine` all belong to unrelated projects.
- **The frontend is `apps/web`.** The four layout directions in `apps/mockups` did their job
  and were deleted; what they taught is recorded in `docs/design/prototype-spec.md`, and the
  components they shared now live in `packages/ui`. `apps/web` static-exports into
  `apps/server/ui/`, which is how the one binary carries both halves.
- **MIT licensed.** New workspaces inherit it; `apps/server` keeps its own `LICENSE` copy so the
  shipped half of the repo carries its licence next to it.

## Don't touch

- `apps/web/AGENTS.md`, if `next dev` writes one — it is generated and carries only Next.js
  rules. Don't hand-edit it; if it turns up dirty, commit it alongside your work rather than
  reverting it.
