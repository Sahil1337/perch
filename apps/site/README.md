# @perch/site

Perch's landing page: a Vite + React app, deployed on Vercel. It shows the product
through `@perch/ui` and the scenes under `src/shared/scenes`.

## Develop

From the repo root (one `bun install` there covers every workspace; never install in here):

```sh
bun run --filter @perch/site dev               # http://localhost:5180
bun run --filter @perch/site dev --port 5183   # any other port
```

The page is `/`. `/lab/` is a dev-only test page with every scene, the bird and the release links
on it; it is not part of the build.

## Build

```sh
bun run --filter @perch/site build     # dist/
bun run --filter @perch/site preview   # serves dist/
bun run --filter @perch/site typecheck
bun run lint                           # from the root; covers apps/site/src
```

## Layout

- `index.html` and `src/page/`: the page. `app.tsx` composes it; `chrome/` is the nav, the
  brand mark and the sky; `layout/` the container, type scale and section anatomy; `sections/`
  the page section by section, each `<name>.tsx` with a `<name>/` folder of its parts when it
  has some. The first view is `landing/`: one copy block and a scene picked by width, each
  scene its own chunk — `keys/` (hunt & peck, from 1024px) and `grid/` (the grid bird, below).
  "Your turn" (`sections/try.tsx`) is the real window the landing hands over to. `bird/` holds
  who flies the one bird (`driver.tsx`: the landing, or the page's roaming route) and that route.
- `src/shared/`: what every page uses: `styles/base.css` (Tailwind, the app's tokens, Geist),
  `scenes` (the product, always dark), `bird` (the 3D bird and its React API), `release` (latest
  release, install command, download links) and `motion`.
- `public/legacy/`: the scene custom elements and their markup, data, fonts and clips, served
  as-is. They load their own files relative to their URL, so keep that folder's structure.

## Vercel

Create the project from this repository with:

- **Root Directory:** `apps/site`
- **Include files outside the root directory in the Build Step:** on (the app builds against
  `packages/ui` and installs from the repo-root lockfile)

`vercel.json` sets the rest: the Vite framework preset, `cd ../.. && bun install --frozen-lockfile`
as the install command, `bun run build`, and `dist` as the output.
