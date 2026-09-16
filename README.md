<div align="center">

<img src="apps/web/app/icon.svg" alt="Perch" width="72">

<h1>Perch</h1>

<h3>A small, fast, local SQL client for Postgres and MySQL.</h3>

<p>
Everything you use every day. None of the administration suite.
</p>

<br>

<img src="https://img.shields.io/badge/PostgreSQL-supported-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
<img src="https://img.shields.io/badge/MySQL-supported-4479A1?style=flat-square&logo=mysql&logoColor=white" alt="MySQL">
<img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License">
<img src="https://img.shields.io/badge/status-early-orange?style=flat-square" alt="Early">

<br><br>

<a href="https://github.com/Sahil1337/perch/releases"><strong>Download</strong></a>
&nbsp;·&nbsp;
<a href="apps/server/README.md"><strong>CLI & API</strong></a>
&nbsp;·&nbsp;
<a href="CONTRIBUTING.md"><strong>Contribute</strong></a>

</div>

<br>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Typing a query in Perch, running it, and reading 12 rows back in 7 milliseconds" width="880">
</p>

---

## Built for reading databases, not administering them

Perch opens on your schema and a cursor. That's the whole product — browse, write SQL, read the
result, leave — without the roles, tablespaces and replication panels you touch once a year.

pgAdmin and MySQL Workbench are administration suites with a query tab attached. Perch is the query
tab, taken seriously: one binary, no account, no cloud, no bundled database, no Electron, and a UI
quiet enough to think in.

**Minimal is about what's on screen, not about what it can do.** Everything below is in there.

---

## Notebooks

Sometimes one query isn't the job. **New notebook** turns the editor into a column of cells you run
independently — each keeping its own result, its own row count and its own execution time, all on
screen at once.

It's Jupyter's idea without Jupyter's file format. There is no ceremony to it — every statement is
a cell. Add `-- %%` markers and those become the boundaries instead,
which is how you get a cell holding `begin; … ; commit;`, or a prose cell:

```sql
-- Query 1
SELECT * FROM orders WHERE status = 'paid' LIMIT 20;

-- %%
-- Query 2: the rewrite
SELECT * FROM orders WHERE status = 'paid' AND created_at > now() - interval '7 days';
```

Save it and you have a plain `.sql` file that runs in `psql` unchanged. Nothing proprietary, nothing
to export, nothing your teammate can't open. Outputs are never written into the file — cached rows
go stale the moment the data changes.

> [!NOTE]
> Notebook view isn't remembered yet: reopen a saved notebook and you get the script editor. The
> `-- %%` markers survive, the view doesn't.

---

## Split panes, for the real question

The question is rarely "what does this return". It's *what changed* — the rewrite next to the
original, without alt-tabbing between two windows to remember.

Drag a tab to any edge to build the layout the task needs, or <kbd>⌘</kbd><kbd>\</kbd> to split
without leaving the keyboard. The rewrite on the left, the original on the right, the result of
whichever you just ran underneath.

Panes resize, tabs move between them, and the whole layout is still there after a reload.

> [!NOTE]
> Every pane shares one results view, so timings arrive one at a time. To put two results and two
> timings on screen at once, run them as notebook cells.

<p align="center">
  <img src="docs/assets/hero.png" alt="Perch with a file open on the left, a notebook on the right, and results below" width="900">
</p>

<p align="center">
  <sub>A file on the left, a notebook on the right, results below. One window, one place to look.</sub>
</p>

---

## Workspaces — open a folder, like your editor

Point Perch at a directory and it works on the `.sql` files already in it. No import step, no
library, no second copy hidden in an app container. Open several folders at once.

* Files open and save **in place**, so your editor, your repo and Perch see the same bytes
* Changed on disk while open? Detected — adopted if you have no edits, offered as a choice if you do
* Autosave with a delay you set, or off entirely
* Recent folders one click away
* Your workspace folders are also the boundary of what the server may read or write

<kbd>⌘</kbd><kbd>S</kbd> on an untitled query asks where to keep it, and from then on it's a normal
file in a normal folder — grep-able, diff-able, committable.

---

## Nothing you run is lost

Every run is recorded — from the UI and the CLI alike — grouped by day, still there after a restart.
Days collapse, so a long history is skimmed at the level of days first.

"Sometime yesterday, the one that returned 43 rows" becomes a findable query again. Click it and
that run comes back into the results pane with its SQL, its outcome and its timing. Rows from the
current session come back with it; **history itself never puts your data on disk**, only what you
ran and how it went.

---

## It already knows your schema

The database you're connected to *is* the workspace. The sidebar tree gives you tables, views and
materialized views, with columns, types, nullability, primary keys and row estimates — searchable
across the whole schema.

The editor shares that same metadata. Type:

```sql
SELECT * FROM ord…
```

and completion offers your actual tables and columns, each labelled with its type. Highlighting is
dialect-aware. A rejected query gets a squiggle under the exact token the server objected to, with
the message on hover, at the offset the server reported — not a guess.

Nothing to define by hand, nothing to keep in sync.

---

## Switching database is boring

As it should be. <kbd>⌘</kbd><kbd>K</kbd>, type the name, <kbd>↵</kbd> — or use the picker in the
topbar. The schema tree, the completions and the editor all follow. No reconnect dance, no stale
tree, no second window.

That one palette covers everything you'd otherwise hunt for:

| Group | Selecting it |
| --- | --- |
| Open files | Focuses the buffer |
| Saved connections | Connects |
| Databases on this server | Switches |
| Tables in the schema | Reveals it in the sidebar |
| Commands | Run, format, new notebook, toggle panels, save… |

---

## Results you can actually read

* **Virtualized**, so a hundred thousand rows scroll like ten
* **Types in the headers**, and `NULL` visibly distinct from an empty string
* **A tab per statement** for multi-statement scripts, each with its own row count and time
* **Grid or text**, a Messages tab for notices, and CSV export
* **Keyboard navigable**, <kbd>⌘</kbd><kbd>C</kbd> to copy

Runs stream as they arrive, and **cancel actually cancels** — the server kills it at the driver, not
just in the browser.

---

## Made to be driven from the keyboard

<kbd>⌘</kbd><kbd>↵</kbd> runs the selection, or the statement under your cursor — not the whole
script by accident. Formatting is **explicit only**: <kbd>⇧</kbd><kbd>⌥</kbd><kbd>F</kbd>, the
right-click menu, or the palette. Your SQL is never rewritten just because you hit save.

| Shortcut | Does |
| --- | --- |
| <kbd>⌘</kbd><kbd>↵</kbd> | Run the selection, or the statement at the cursor |
| <kbd>⌘</kbd><kbd>⇧</kbd><kbd>↵</kbd> | Run the whole file |
| <kbd>⌘</kbd><kbd>K</kbd> | Command palette |
| <kbd>⌘</kbd><kbd>B</kbd> | Sidebar |
| <kbd>⌘</kbd><kbd>J</kbd> | Results pane |
| <kbd>⌘</kbd><kbd>S</kbd> | Save |
| <kbd>⌘</kbd><kbd>\</kbd> | Split the pane |
| <kbd>⌘</kbd><kbd>,</kbd> | Settings |
| <kbd>⇧</kbd><kbd>⌥</kbd><kbd>F</kbd> | Format the document |

On Windows and Linux, <kbd>Ctrl</kbd> throughout.

> [!NOTE]
> **Next up: seeing the shape of your data.** A relationship view — tables drawn with the keys that
> join them, so a schema you've never met explains itself. Foreign-key introspection is the piece
> still missing; it's the next thing being built.

---

## It finds your database for you

No hunting for the port, no copying a connection string out of a `.env` you half remember.

```console
$ perch discover
dialect  | address        | up | version         | sources          | suggested url
---------+----------------+----+-----------------+------------------+-----------------------------------------
postgres | 127.0.0.1:5432 | ✓  | PostgreSQL 18.4 | port,binary,brew | postgres://you@127.0.0.1:5432/postgres
1 found in 730 ms · os user you
```

Default ports, binaries on your `PATH`, Homebrew and systemd services, Windows services and Docker
containers — checked in parallel, in about half a second. On first run Perch offers what it found,
you press Connect, and you're working. It never bundles or installs a database of its own.

---

## The same workspace, from your terminal

Not a second product. The same connections, the same `.sql` files, the same history.

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

$ perch                       # same workspace, in a window
```

`perch run` talks to the driver directly — nothing to boot, nothing left running afterwards, exit
code 1 on a SQL error with a caret under the position. Which makes it a fine fit for scripts,
Makefiles and CI, and for the query you were going to pipe into something anyway.

<details>
<summary><strong>See all commands</strong></summary>

<br>

```sh
perch                                  # start the server and open the UI
perch discover                         # what's already on this machine?

perch conn add <name> <url> --test     # save a connection
perch conn ls                          # list them (passwords never printed)
perch conn test <name>                 # round-trip, with latency
perch conn dbs <name>                  # databases on that server

perch schema <conn> --table public.orders

perch run <conn> query.sql --format csv   # table | json | csv | ndjson
cat q.sql | perch run <conn> -            # or a pipe
perch history --limit 20 --conn <conn>

perch files ls ~/sql
perch settings get
perch settings set theme light

perch serve --port 4600 --dir ~/sql
perch status
perch stop
```

Every command supports `--help`. Commands that output data support `--json`.

**[Full CLI & HTTP API →](apps/server/README.md)**

</details>

---

## Local by design

Everything Perch keeps lives in plain files you can read, edit or delete:

```text
~/.perch/
├── connections.json    saved connections, incl. passwords (mode 0600)
├── settings.json       autosave, maxRows, workspaces, theme
├── history.jsonl       append-only run history (no result rows on disk)
├── server.json         pid/url of the running server (mode 0600)
└── queries/            your .sql files, opened as the first workspace
```

**No telemetry. No cloud sync. No phoning home.** Your SQL stays where it already is, and
`PERCH_HOME` moves the whole directory if you want it elsewhere.

> [!WARNING]
> Saved credentials live in `~/.perch/connections.json`. The file is permission-restricted, but it
> is **not a secrets vault** — don't commit or sync it.

> [!WARNING]
> The server binds to `127.0.0.1` and has **no login**: loopback is the security boundary, so
> anything that can reach the port can run queries. `perch serve --host <addr>` past localhost hands
> the API to everyone on that network, and says so when it starts.

---

## One binary. That's it.

```sh
chmod +x perch
mv perch /usr/local/bin/perch

perch
```

**[Download the latest release →](https://github.com/Sahil1337/perch/releases)**

No Electron runtime. No bundled database. No background service you forget you installed.

> [!NOTE]
> macOS may quarantine downloaded binaries. If Gatekeeper blocks Perch:
> `xattr -d com.apple.quarantine /usr/local/bin/perch`

---

## Status

> [!WARNING]
> **Perch is early-stage software.** Used daily, and young.

| Component | Status |
| --- | --- |
| CLI | Stable |
| HTTP API | Complete |
| Web UI | Active development |
| Cross-platform releases | Manual for now |

Postgres is the best-travelled path; MySQL is supported and less exercised. The driver interface is
deliberately small, so another dialect is contained work rather than a rewrite — SQLite and SQL
Server aren't there today.

Honestly unfinished: notebook view isn't remembered across reopen, foreign keys aren't introspected
(which is what the relationship view is waiting on), and passwords are in a 0600 file rather than
the OS keychain.

If something feels wrong, [open an issue](https://github.com/Sahil1337/perch/issues). "Feels wrong"
is a legitimate bug report here.

---

## Questions

<details>
<summary><strong>Why not pgAdmin or MySQL Workbench?</strong></summary>

<br>

Use them for what they're good at: roles, replication, backups, maintenance, server configuration.
Real administration work deserves a real administration tool.

Perch is for the loop those tools make heavy — look at the schema, write SQL, read the result,
leave — and it tries to make that loop fast, keyboard-driven and pleasant to sit in. They're not
competing for the same hour of your day.

</details>

<details>
<summary><strong>Why a local server and a browser, not a desktop app?</strong></summary>

<br>

One binary on every OS, no Electron runtime, no code-signing dance, no second copy of Chrome on your
disk. The UI is a plain HTTP client of a loopback server — which is also why the CLI and the window
share connections, files and history without either being the "real" one.

</details>

<details>
<summary><strong>Why isn't SQLite supported?</strong></summary>

<br>

Not yet. Postgres and MySQL today. The database layer sits behind a small driver interface, so
adding a dialect is isolated work rather than a rewrite. See [CONTRIBUTING.md](CONTRIBUTING.md) if
you'd like to add one.

</details>

---

## Contributing

Perch is still taking shape, which is the best time to arrive. Another driver, a better SQL
workflow, editor polish, schema exploration, CLI features, UI work — all welcome.

**[Contributing guide →](CONTRIBUTING.md)**

---

<div align="center">
<sub><strong>MIT</strong> © <a href="https://github.com/Sahil1337">Sahil1337</a> · <a href="https://github.com/Sahil1337/perch/issues">Issues</a> · <a href="CONTRIBUTING.md">Contributing</a></sub>
</div>
