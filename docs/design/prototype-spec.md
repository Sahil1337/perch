# Frontend prototype spec

The layout decision is made. It is not one of the four mockup directions — it is a merge, taking
each region from whichever direction did it best. This document is what `apps/web` was built
from; `apps/mockups` was deleted in the same pass (see "How the mockups were dismantled" in
[../architecture/monorepo.md](../architecture/monorepo.md)), so the directions survive only
here.

Where a region came from is noted as A/B/C/D — A classic, B notebook, C split, D focus.

## Shell (A)

```
┌────────────────────────────────────────────────────────────┐
│ ▤  prod-replica · app_db ▾                  Saved  ▶Run  ⚙ │ 48
├─────────────┬──────────────────────────────────────────────┤
│ Schema      │ orders-by-day.sql ×   churn.sql ×   +        │ 36
│ Files       ├──────────────────────────────────────────────┤
│ History     │  1  select                                   │
│ ─────────── │  2    date_trunc('day', o.created_at)        │
│ orders      │  3  from orders o                            │
│   id  int8🔑│  4  where o.status = 'paid'                  │
│ customers   ╭──────────────── ▬▬ ──────────────────────  ×╮│
│ daily_rev 👁│ │ Results  Messages        30 rows   ▦ ≡  ⤓ ││
│ ─────────── │ ├──────────────────────────────────────────┤│
│ 📓 Open SQL │ │ day          orders    revenue           ││
│    Notebook │ │ 2026-09-14      318   24,911.50          ││
├─────────────┴─╰──────────────────────────────────────────╯─┤
│ ● prod-replica · app_db   Ln 4, Col 18   Saved   142 ms    │ 24
└────────────────────────────────────────────────────────────┘
```

**Topbar** (48px) — sidebar toggle, connection picker (connection + database), then save
indicator, Run button, settings gear.

**Status bar** (24px, one row). C's three stacked status strips collapse into this one.

## Sidebar

Resizable **180–600px** — drag the divider either way, double-click resets to 256, `⌘B`
collapses to zero, width persisted. A's 200–420 clamp is deliberately widened.

Tabs: **Schema | Files | History**. Below them, an **Open SQL Notebook** action.

### Schema tree

Flattened from the mockup's five levels to two:

- **No database root.** The selected database is already in the topbar and the status bar. The
  tree *is* the current database's contents and swaps when the picker changes — which also fixes
  the mockup bug where `state.database` was only the root row's label.
- **No Tables/Views folders.** `Table["kind"]` is an icon, not a folder.
- **Schema level only when it carries information**: a Postgres database with more than one
  non-system schema. Never for MySQL, where `SCHEMA` and `DATABASE` are synonyms and
  `readSchema` always returns exactly one.
- **Three kinds: table, view, materialized view.** The protocol has all three; the mockup filters
  on two, so matviews vanish the moment real introspection is wired. Matviews carry a badge —
  "stale until REFRESH" is the thing you need to know about them.
- Search, plus a **refresh** button hitting `?refresh=1`. Nothing invalidates `SchemaCache`
  (30s TTL) and no `ServerEvent` reports a schema change, so this is the only way back to truth
  after a DDL statement. Re-fetch automatically after any run whose `command` is DDL.

## Editor

**CodeMirror 6.** Replaces the mockup's 248-line textarea + regex overlay.

| Need | How |
|---|---|
| Highlighting | `@codemirror/lang-sql`, `PostgreSQL` / `MySQL` dialect per connection |
| `table.column` completion | same package's `schema` option, fed from `DatabaseSchema` |
| Alias resolution (`from orders o` → `o.`) | built in |
| Format document | `sql-formatter`, `⇧⌥F`, `keywordCase: "lower"` |
| Error squiggle | `@codemirror/lint`, at `statement.offset + error.position` |
| Settings at runtime | compartments — no remount, no lost cursor |

**No pre-run validation.** Errors surface after Run, where `toQueryError` already gives an exact
0-based offset into the statement (`postgres/types.ts:81`, and MySQL via `at line N`). Treating
the server as the only source of truth avoids maintaining a second, subtly-wrong SQL grammar.

`⌘↵` runs the statement under the cursor. `⌘⇧↵` runs the whole file.

Keep the existing `highlightSql` regex tokeniser for read-only SQL previews (history rows,
palette entries) — a CodeMirror instance per list row would be absurd.

`sql-formatter` is lazy-loaded on first use and throws on input it cannot parse; catch and keep
the original text. Format per statement, skipping any statement containing a dollar-quoted body.

## Results (D's sheet, docked)

D's drag handle, spring and slide-away, but **docked** rather than overlaying: the sheet pushes
the editor up instead of covering it, because this layout's core loop is read-result → edit-query
→ rerun. `⌘J` toggles.

Inside:

- **Results | Messages** tabs. Messages renders `QueryError.detail` and `.hint`, not just
  `.message`.
- **Grid | Text** toggle (▦ / ≡, C). Text is `renderResultAsText`, harvested from
  `split/page.tsx` before that file is deleted.
- **Export CSV** → `GET /api/runs/:id/export`. The mockup's button has no handler.
- **Cancel** while running → `POST /api/runs/:id/cancel`, which no mockup has. The client
  generates `runId` when submitting so it has something to cancel with; let the server invent it
  and the run is unaddressable.
- **Statement strip** when a run produces more than one `StatementResult`:
  `[1] 30 rows · 142ms  [2] 1 row · 38ms  [3] DELETE 412`. Hidden for single-statement runs.
  This is what replaces B-as-a-layout: per-query pairing without a document model.
- DML/DDL renders as `DELETE 412`, not as an error. The mock reducer's
  `columns.length === 0 ? "error" : "done"` is wrong and goes away with the mock.
- **The grid is virtualized** (`@tanstack/react-virtual`, fixed row height). `maxRows` defaults
  to 1000 and the mockup's plain `<table>` renders every row. Doing this first constrains how
  sticky headers and column resize get built, so it is not a retrofit.
- **Runs are synchronous.** `POST /api/query/sync` returns one `RunRecord` with every statement's
  result; a skeleton covers the wait. The NDJSON route streams the same run and stays available,
  but nothing needs it — results are capped at `maxRows`, so there is no payload to spread out.
  If slow queries make progressive rows worth having later, it is a change inside the provider.

## Notebook

Same shell; the main area becomes a column of cards. Entered via **Open SQL Notebook**.

**One plain `.sql` file — no new format, no new `FileEntry` kind, no protocol change.**

- File contains no `-- %%` → **cells are the statements**, split with the same splitter the
  server uses. Every existing `.sql` file opens as a notebook with zero ceremony.
- File contains `-- %%` → **explicit boundaries**. Needed for a cell holding
  `begin; … ; commit;`, for an unterminated statement, and for prose cells (a comment-only chunk
  is otherwise dropped by `isBlank`). "Open SQL Notebook" creates a file with markers in it.

Detection is one `includes("-- %%")`. The file stays valid SQL either way — it runs in `psql` and
opens in any editor.

Results are keyed to `(cell index, hash of the cell's SQL)`, so editing a card clears its stale
output. Outputs are never written to the file: cached rows go stale the moment the data changes.
A card may hold several statements, in which case it gets the statement strip.

Run button becomes **Run all**.

## Decisions taken with defaults

- **Dark and light, no "system".** `Settings.theme` is `dark | light` — the flip the token work
  was written for. Following the OS was the third option and is gone: the preference lives on the
  server, shared by every browser pointed at the machine, and a per-machine setting that silently
  changes itself at sunset is a setting you cannot answer "what is it set to?" about.
- **`@perch/sql`** — a new leaf package holding `splitStatements`. Both run-statement-under-cursor
  and the notebook's `;`-mode need it client-side, and `apps/server/src/core/sql/split.ts` is
  unreachable (nothing may depend on `apps/server`, and `@perch/protocol` is types-only). The
  alternative is duplicating 150 lines of dollar-quote and nested-comment parsing and letting the
  two copies drift.
- **Editor settings**: appearance (font size, wrap) in `localStorage`; behaviour
  (`keywordCase`, `formatOnSave`) added to the protocol's `Settings` when that screen is built.

## Deleted with the mockups

`app/split/`, `app/focus/`, `app/page.tsx`, `lib/directions.ts`,
`components/workspace/direction-switcher.tsx`, `components/workspace/icon-rail.tsx`.

Harvest before deleting: `renderResultAsText` (C), the sheet and its drag handle (D), the run
history list (B).

Also dropped on the way into `packages/ui`: the 44 unused `components/ui` files and the unused
dependencies (`recharts`, `zod`, `@dnd-kit/*`, `@hugeicons/*`, `@daypicker/react`,
`@tanstack/react-table`, `glimm`, `liveline`). None reach the bundle today, but `chart.tsx`
alone would pull in 9.1MB of recharts the day someone imports it.

## Parked

- **ER / relational schema view.** Mermaid `erDiagram`, driven by PK and FK constraints. Blocked
  on backend work first: **foreign keys are not introspected** — neither `postgres/introspect.ts`
  nor `mysql/introspect.ts` reads `pg_constraint` or `key_column_usage`, and `Table` carries no
  constraints. Needs a new query per dialect plus a `@perch/protocol` addition (most likely
  `Table.foreignKeys`) before any UI. PKs are already available.
- **Connections CRUD screen.** Eight routes exist; the UI has a picker over the configured list
  and no way to add, edit or test one. Topbar picker stubs it in v1.
- **Settings screen.** `GET/PUT /api/settings` exist; the gear is a no-op. Stubbed in v1.
