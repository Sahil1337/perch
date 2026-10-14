# Capture

The recording rig for the site's captured assets, made from the real app running against a real
Postgres. None of it is deployed. `capture.ts` was written for `<perch-workspace>`, which the real
`@perch/ui` scenes have replaced: of what it writes, only `fonts/` is still loaded (by the walk and
terminal scenes), so a re-run brings back `css/`, `markup/` and `data/*.json` files nothing reads.

| File            | What it is                                                                       |
| --------------- | -------------------------------------------------------------------------------- |
| `birdwatch.sql` | The sample database: real species and places, invented observers, spring 2026.   |
| `queries/`      | The three `.sql` files the window has open. `spring-migration.sql` is the hero.  |
| `capture.ts`    | Runs the built `perch`, drives it in headless Chrome, writes the assets.         |

## Re-recording

You need the built binary, a local Postgres, Google Chrome and bun.

```sh
createdb perch_site_demo
psql -d perch_site_demo -f apps/site/capture/birdwatch.sql   # idempotent; rerun to reset the data
bun run build                                            # apps/server/dist/perch, with the current UI
bun apps/site/capture/capture.ts
```

The script starts its own `perch serve` on port 4691 with a throwaway `PERCH_HOME` and workspace
folder (both deleted when it exits, so `~/.perch` is never touched), adds a `birdwatch` connection
over the API, and drives a headless Chrome with its own throwaway profile.

Environment, all optional: `PGHOST`, `PGPORT`, `PGUSER` (default: your login name) and
`CAPTURE_DB` for the database; `CAPTURE_PORT` and `CAPTURE_CDP_PORT` for the two ports; `CHROME` for
the browser binary; `CAPTURE_REF` for where reference screenshots and full DOM snapshots go
(default `$TMPDIR/perch-site-reference`).

## What it writes

Into `apps/site/public/legacy/`:

- `css/app.css` — the app's compiled stylesheet plus the CSS CodeMirror injects at runtime (its
  generated `ͼ…` classes), adapted to live in a shadow root: fonts and `@property` registrations
  become things a shadow tree honours, viewport media queries are resolved for the captured width
  (1280px), and the theme tokens are put in force at `:host`, dark.
- `fonts/` — Geist and Geist Mono, latin and latin-ext, with `OFL.txt`.
- `markup/workspace.html` — the app root in the hero's first frame.
- `markup/states.json` — every later state, stored as only the regions that differ from that frame:
  `k1`–`k3` (typing `g`, `gr`, `gro`), `k4` (`group by` accepted), `s1` and `s2` (the column
  completion after `s` and `s.`), `typed`, `saved`, `running`, `results`, and `tree` (every table
  expanded, for the sidebar).
- `data/*.json` — each query's columns, rows, row count and timings from the run the UI showed, and
  `schema.json`, the tree the sidebar draws.

## Privacy

Snapshots are scrubbed as they are taken: the throwaway workspace reads `~/birdwatch`, perch's home
reads `~/.perch`, any `/Users/<name>` or `/home/<name>` becomes `~`, and your login name becomes
`birder`. Grep before committing a fresh capture:

```sh
grep -rniE "$(whoami)|/Users/|/private/|/var/folders" apps/site/public
```

## Reviewing

Run the site and open its lab page, which mounts every scene:

```sh
bun run --filter @perch/site dev
# http://localhost:5180/lab/
```
