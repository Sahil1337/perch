<div align="center">

<img src="apps/web/app/icon.svg" alt="Perch" width="72">

<h1>Perch</h1>

<p><strong>A lightweight SQL client for PostgreSQL and MySQL.</strong></p>

<p>
<a href="#installation">Installation</a> ·
<a href="#getting-started">Getting started</a> ·
<a href="#features">Features</a> ·
<a href="apps/server/README.md">CLI & API</a> ·
<a href="CONTRIBUTING.md">Contributing</a>
</p>

<img src="https://img.shields.io/badge/PostgreSQL-supported-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
<img src="https://img.shields.io/badge/MySQL-supported-4479A1?style=flat-square&logo=mysql&logoColor=white" alt="MySQL">
<img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License">

</div>

<br>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Writing a query in Perch, running it, and reading 12 rows back in 7 milliseconds" width="820">
</p>

Perch is a small, fast, local SQL client for Postgres and MySQL, built for developers who spend more time querying databases than administering them.

It gives you a focused workspace for the everyday loop:

browse the schema → write SQL → read the result

Unlike full administration suites, Perch keeps the interface focused on the work you actually do: exploring tables, writing queries, comparing results, and jumping between databases.

Two of the features are there to make a database legible rather than to run queries faster:
[Relationship view](#relationship-view) draws the schema and the keys that join it, and
[Query walk](#query-walk) plays a `SELECT` through its clauses in the order the database evaluates
them, using your own rows. They are worth a look if you are learning SQL, teaching it, or reading
someone else's query for the first time — the parts a `psql` prompt leaves you to picture in your
head.

It ships as a single binary and runs entirely on your machine. No account, no cloud service, no bundled database, and no Electron runtime.

## Installation

Download the binary for your platform from [Releases](https://github.com/Sahil1337/perch/releases):

```sh
chmod +x perch
mv perch /usr/local/bin/perch
```

macOS may quarantine downloaded binaries. If Gatekeeper blocks it:

```sh
xattr -d com.apple.quarantine /usr/local/bin/perch
```

Building from source is covered in [CONTRIBUTING.md](CONTRIBUTING.md).

## Getting started

```sh
perch
```

The first run walks you through a workspace folder, a connection and a database. Perch detects
servers already running on the machine — default ports, binaries on `PATH`, Homebrew and systemd
services, Windows services and Docker containers — so in most cases the connection is one click:

```console
$ perch discover
dialect  | address        | up | version         | sources          | suggested url
---------+----------------+----+-----------------+------------------+---------------------------------------
postgres | 127.0.0.1:5432 | ✓  | PostgreSQL 18.4 | port,binary,brew | postgres://you@127.0.0.1:5432/postgres
1 found in 730 ms · os user you
```

Perch never bundles or installs a database of its own.

## Features

### Schema-aware editor

The connected database drives the workspace. The sidebar lists tables, views and materialized views
with their columns, types, nullability, primary keys and row estimates, searchable across the whole
schema. The editor draws on the same metadata: completion offers real tables and columns labelled
with their types, highlighting is dialect-aware, and a rejected statement is underlined at the exact
offset the server reported, with the message on hover.

<p align="center">
  <img src="docs/assets/schema-editor.png" alt="Schema tree with a table expanded to its columns, types and keys, beside an editor holding a formatted query" width="680">
  <br><sub>Types, nullability, primary keys and row estimates — the same metadata the editor completes from.</sub>
</p>

<kbd>⌘</kbd><kbd>↵</kbd> runs the selection or the statement under the cursor;
<kbd>⌘</kbd><kbd>⇧</kbd><kbd>↵</kbd> runs the file. A running query can be cancelled, and the server
cancels it at the driver rather than only in the browser.

### Relationship view

**Visualise relationships** in the schema sidebar (also in the palette) draws the database: every
table as a card of typed columns with its primary and foreign keys marked, and every foreign key as
a wire from the column that holds it to the key it points at, with a pulse travelling the direction
the reference goes. Referenced tables are laid out left of the tables that reference them; tables
with no keys in either direction sit in a grid underneath. Click a table to see only what joins to
it, drag cards to rearrange, scroll to pan and <kbd>⌘</kbd>-scroll to zoom. Opened from a selected
table, the view starts centred on it.

<!-- TODO(asset): docs/assets/relationship-view.png — the diagram with a table selected, its wires
     highlighted and the rest dimmed. Alt: "Tables as cards of typed columns, joined by foreign-key
     wires, with one table selected." -->

A real schema has tables wide enough to make every card a screen tall, so when any table runs past
a dozen columns the view opens in **keys-only** mode: each card shows the columns that take part in
a relation and a row saying how many it is hiding, and expands on request. Where you drag the cards
is remembered per connection and database, so the picture you arranged is the one you come back to.

### Query walk

**Visualise query** in the editor's right-click menu (also in the palette) takes the selection, or
the statement under the cursor, and plays it through the order the database actually evaluates it
in — FROM, JOIN, WHERE, GROUP BY, HAVING, window functions, SELECT, DISTINCT, ORDER BY, LIMIT —
with the rows and counts your connected database returns at each station, and a sentence saying
what that station did to them. A window function gets its own station, where the panes it partitions into are
drawn and every row keeps its place; a `CASE` is read branch by branch, each row taking the first
`WHEN` that is true of it.

<!-- TODO(asset): docs/assets/query-walk.gif — a grouped query playing from FROM through GROUP BY to
     LIMIT, rows moving between stations. Alt: "A SELECT walked station by station, with the rows
     the database returned at each one." -->

Nothing on screen is illustrative. Every station's query is your own SQL spliced back together and
run against the current database, and the statements that ran are in a tab beside the query, so the
result you are shown is one you could have run yourself. Those runs are read-only, sample 25 rows,
and never enter run history. A clause the query does not use still gets a station, marked absent and
narrated as what it would have done — which is how the walk answers "why can't WHERE see my alias".

A statement is read as a **program of sections**: each CTE, derived table, subquery predicate and
branch of a set operation is a chapter with its own walk, laid out in dependency order on a strip
above the station rail, and playback runs straight through them. A correlated subquery is not
flattened into a single result — it runs once per outer row, with a scrubber underneath carrying
each row's verdict, and every correlated reference replaced by that row's value, so
`takes.ID = s.ID` becomes `takes.ID = '12345'` on screen. Parts of a query that could not be sliced
into a section are listed rather than quietly dropped.

A `UNION`, `INTERSECT` or `EXCEPT` gets a chapter for each branch and then one more for each meeting
of two results, in the order the database evaluates them — `INTERSECT` binds tighter than the other
two, so it is walked first. That chapter shows the two sides, then the three regions they divide
into (only on the left, in both, only on the right) with the ones this operator keeps marked, then
the answer itself. Every region is a set operation the database evaluated over the full branches,
never a comparison of the two sampled cards. An `ALL` variant keeps duplicates, so it shows the
sides and the answer and says why the regions do not describe it.

A subquery correlated on both sides — `WHERE NOT EXISTS (... WHERE NOT EXISTS (...))`, the shape
behind relational division — gets a grid instead of a scrubber: outer rows down the side, the
subquery's own rows across the top, and a cell holding the innermost check for that pair, tinted by
what it does to the outer verdict. That grid is the only view where "no student has taken every
required course" is visible at all — no single position of a per-row scrubber can show a comparison
across rows.

<!-- TODO(asset): docs/assets/query-walk-grid.png — the division grid with one cell picked and its
     row and column highlighted. Alt: "Outer rows down the side, subquery rows across the top, one
     cell picked and its bound SQL shown beside it." -->

<!-- TODO(asset): docs/assets/query-walk-sections.png — the chapter strip over a correlated
     subquery's per-row scrubber. Alt: "Chapter strip with a CTE, a subquery and the main query,
     above a scrubber with one tick per outer row." -->

<kbd>Space</kbd> plays and pauses, <kbd>←</kbd> and <kbd>→</kbd> step a phase at a time across
station and chapter boundaries, and playback can be halved to 0.5×. Click any station on the rail
or any chapter on the strip to jump to it. Under `prefers-reduced-motion` the scenes cut instead of
animating.

Walks are built for `SELECT`. A step with no clauses to walk — a `VALUES` list, a `SELECT`
with no `FROM` — still gets a chapter showing what it produces, and a `WITH` step that writes to
the database is shown but never run. A statement Perch cannot slice says so instead of guessing.

### SQL notebooks

A notebook is a view of an ordinary `.sql` file, in the spirit of a Jupyter notebook. The editor
becomes a column of cells that run independently, each keeping its own result, row count and
execution time — which is how two versions of a query end up on screen together.

```sql
-- Query 1
SELECT * FROM orders WHERE status = 'paid' LIMIT 20;

-- %%
-- Query 2: the rewrite
SELECT * FROM orders WHERE status = 'paid' AND created_at > now() - interval '7 days';
```

<p align="center">
  <img src="docs/assets/notebook.png" alt="A notebook with two cells, each showing its own result grid, row count and execution time" width="660">
  <br><sub>Each cell keeps its own rows, row count and timing.</sub>
</p>

By default every statement is a cell, so any `.sql` file opens as a notebook with no conversion.
Adding `-- %%` markers makes those the boundaries instead, which is what a cell containing
`begin; … ; commit;` needs. The file stays valid SQL and runs in `psql` unchanged; results are never
written into it.

### Split panes

Editors and results live in a resizable pane grid. Drag a tab to any edge, or press
<kbd>⌘</kbd><kbd>&#92;</kbd>, to put two queries side by side and compare their results and timings
directly. Panes resize, tabs move between them, and the layout is restored on reload.

<p align="center">
  <img src="docs/assets/hero.png" alt="A file open on the left with its results below, and a notebook in a second pane on the right" width="700">
  <br><sub>A file and its results on the left, a notebook on the right — one window.</sub>
</p>

### Workspace folders

Perch opens directories, the way an editor does, and works on the `.sql` files already in them —
no import step and no separate library. Several folders can be open at once, and they define the
boundary of what the server is allowed to read and write.

- Files open and save **in place**, so your editor, your repository and Perch see the same bytes
- External changes are detected: adopted when the buffer is clean, offered as a choice when it is not
- Reopens the tabs you had open, and which one had focus, on your next visit — remembered per
  machine, not written into the workspace
- Autosave with a configurable delay, or off
- <kbd>⌘</kbd><kbd>S</kbd> on an untitled query saves it into a workspace folder of your choosing

<table align="center">
<tr>
<td align="center" width="40%">
  <img src="docs/assets/workspace-files.png" alt="Files panel listing the .sql files in an open workspace folder" width="210">
</td>
<td align="center" width="60%">
  <img src="docs/assets/open-folder.png" alt="The folder picker, browsing the filesystem to choose a workspace directory" width="400">
</td>
</tr>
<tr>
<td align="center"><sub>The files already in the folder.</sub></td>
<td align="center"><sub>Pick a folder, or its parent to see everything at once.</sub></td>
</tr>
</table>

### Result grid

Results are virtualized, so a large result scrolls like a small one. Column types appear in the
headers and `NULL` is visually distinct from an empty string. A multi-statement run gets one tab per
statement with its own row count and duration, alongside a Messages tab for server notices. Results
can be viewed as a grid or as text, copied with <kbd>⌘</kbd><kbd>C</kbd>, or exported to CSV.

<p align="center">
  <img src="docs/assets/results.png" alt="Result grid with typed column headers, a row count and duration, and grid, text and export controls" width="700">
  <br><sub>Types in the headers, row count and duration above them.</sub>
</p>

### Run history

Every run — from the UI and from the CLI — is recorded and grouped by day, and survives a restart.
Selecting a past run restores it in the results pane with its SQL, outcome and timing. History
records what was run and how it went; result rows are never written to disk.

<p align="center">
  <img src="docs/assets/history.png" alt="History sidebar with runs grouped under Today and Yesterday, each with a row-count badge" width="300">
  <br><sub>Grouped by day, collapsible, still there after a restart.</sub>
</p>

### Command palette

<kbd>⌘</kbd><kbd>K</kbd> searches open files, saved connections, databases on the current server,
every table in the schema, and the commands. Selecting a connection connects to it; selecting a
database switches to it, and the schema tree, completions and editor follow without a reconnect
step.

<p align="center">
  <img src="docs/assets/command-palette.png" alt="Command palette open, showing grouped actions with their shortcuts and a saved connection" width="560">
  <br><sub>Actions, connections, databases, files and tables in one search.</sub>
</p>

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| <kbd>⌘</kbd><kbd>↵</kbd> | Run the selection, or the statement at the cursor |
| <kbd>⌘</kbd><kbd>⇧</kbd><kbd>↵</kbd> | Run the whole file |
| <kbd>⌘</kbd><kbd>K</kbd> | Command palette |
| <kbd>⌘</kbd><kbd>B</kbd> | Toggle the sidebar |
| <kbd>⌘</kbd><kbd>J</kbd> | Toggle the results pane |
| <kbd>⌘</kbd><kbd>S</kbd> | Save |
| <kbd>⌘</kbd><kbd>&#92;</kbd> | Split the pane |
| <kbd>⌘</kbd><kbd>,</kbd> | Settings |
| <kbd>⇧</kbd><kbd>⌥</kbd><kbd>F</kbd> | Format the document |

Use <kbd>Ctrl</kbd> instead of <kbd>⌘</kbd> on Windows and Linux. Formatting is explicit only — from
the shortcut, the right-click menu or the palette — and never runs on save.

## Command line

The CLI and the UI share the same connections, files, history and settings.

```console
$ perch conn add local postgres://user:pass@localhost:5432/shop
$ perch conn test local
ok · PostgreSQL 16.2 on x86_64-pc-linux-gnu · 11 ms

$ perch run local -e "select status, count(*) from orders group by 1"
status   | count
---------+------
paid     |  1204
refunded |    37
2 rows · 8 ms
```

`perch run` connects through the driver directly — no server is started and nothing is left running
afterwards. It exits non-zero on a SQL error and prints a caret under the reported position, which
makes it usable from scripts, Makefiles and CI.

<details>
<summary><strong>All commands</strong></summary>

<br>

```sh
perch                                  # start the server and open the UI
perch discover                         # find databases running on this machine

perch conn add <name> <url> --test     # save a connection
perch conn ls                          # list connections (passwords are never printed)
perch conn test <name>                 # round-trip test with latency
perch conn dbs <name>                  # databases on that server
perch conn rm <name>                   # remove a connection

perch schema <conn> [--table public.orders]

perch run <conn> query.sql --format csv   # table | json | csv | ndjson
cat q.sql | perch run <conn> -            # or read from a pipe
perch history --limit 20 --conn <conn>

perch files ls ~/sql
perch settings get [key]
perch settings set <key> <value>

perch serve --port 4600 --dir ~/sql
perch status
perch stop
```

Every command accepts `--help`, and commands that print data accept `--json`.

**[Full CLI and HTTP API reference →](apps/server/README.md)**

</details>

## Configuration

State lives in plain files under `~/.perch`, which `PERCH_HOME` relocates:

```text
~/.perch/
├── connections.json    saved connections, including passwords (mode 0600)
├── settings.json       autosave, max rows, query timeout, workspaces, theme
├── history.jsonl       append-only run history (no result rows)
├── server.json         pid and url of the running server (mode 0600)
└── queries/            .sql files, opened as the first workspace
```

Settings are editable in the UI with <kbd>⌘</kbd><kbd>,</kbd> or from the CLI with
`perch settings set`. Perch sends no telemetry and contacts no remote service.

> [!WARNING]
> `connections.json` is permission-restricted but is **not a secrets vault** — do not commit or sync
> it. The server binds to `127.0.0.1` and has **no authentication**: loopback is the security
> boundary, so anything that can reach the port can run queries. `perch serve --host <addr>` exposes
> the API to that network and warns when it starts.

## Roadmap

- **Persistent notebook view** — reopening a saved notebook currently returns the script editor; the
  `-- %%` markers survive, the view does not.

## Contributing

A Bun workspace monorepo — setup, scripts, project layout and verification steps are in
[CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and feature requests:
[Issues](https://github.com/Sahil1337/perch/issues).

## License

[MIT](LICENSE) © [Sahil1337](https://github.com/Sahil1337)
