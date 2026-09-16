<div align="center">

<img src="apps/web/app/icon.svg" alt="Perch" width="72">

<h1>Perch</h1>

<h3>A fast, local SQL client for Postgres and MySQL.</h3>

<p>
Browse your database. Write SQL. Inspect results.<br>
<strong>Then get back to your code.</strong>
</p>

<br>

<img src="https://img.shields.io/badge/PostgreSQL-supported-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
<img src="https://img.shields.io/badge/MySQL-supported-4479A1?style=flat-square&logo=mysql&logoColor=white" alt="MySQL">
<img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License">
<img src="https://img.shields.io/badge/status-early-orange?style=flat-square" alt="Early">

<br><br>

<a href="https://github.com/Sahil1337/perch/releases">
  <strong>Download</strong>
</a>
&nbsp;&nbsp;·&nbsp;&nbsp;
<a href="apps/server/README.md">
  <strong>CLI & API</strong>
</a>
&nbsp;&nbsp;·&nbsp;&nbsp;
<a href="CONTRIBUTING.md">
  <strong>Contribute</strong>
</a>

</div>

<br>

<p align="center">
  <img src="docs/assets/demo.svg" alt="Typing a query in Perch, running it, and reading 12 rows back in 5 milliseconds" width="860">
</p>

<p align="center">
  <sub>Type it. Run it. Read it. Your database, your machine, your SQL.</sub>
</p>

---

## SQL without the ceremony

Database clients have a tendency to become **database administration suites**.

Perch is built for the everyday loop instead:

```text
Connect → Explore → Query → Inspect → Done
```

No account, no cloud, no bundled database, no giant application to keep open.

---

## Built for the way you actually work

<table>
<tr>
<td width="50%" valign="top">

### It knows your schema

The database you are connected to drives the workspace.

* Tables and columns
* Types and nullability
* Primary keys and row estimates
* Search across tables
* Autocomplete from the live schema

No schema definitions to maintain by hand.

</td>

<td width="50%" valign="top">

### Write SQL, fast

Run exactly what you are working on.

<kbd>⌘</kbd> <kbd>↵</kbd>
Run the selection, or the statement at the cursor

<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>↵</kbd>
Run the whole file

Cancel a query while it is still running — the server cancels it at the driver.

</td>
</tr>

<tr>
<td width="50%" valign="top">

### Results that stay usable

Virtualized, so a large result scrolls like a small one.

Types in the headers. `NULL` visibly distinct from an empty value. Multi-statement scripts get a
tab per statement with its own row count and time.

Keyboard navigable, <kbd>⌘</kbd><kbd>C</kbd> to copy, and CSV export.

</td>

<td width="50%" valign="top">

### Nothing you run is lost

Every query is recorded and still there after a restart, grouped by day.

Click any past run to bring its rows and its timing back.

History keeps what you ran — result rows are never written to disk.

</td>
</tr>
</table>

---

## Find your database

Perch discovers databases already running on your machine — Postgres or MySQL, from a default port,
a Homebrew or systemd service, a Docker container, or a binary on your `PATH`.

```console
$ perch discover
dialect  | address        | up | version         | sources          | suggested url
---------+----------------+----+-----------------+------------------+-----------------------------------------
postgres | 127.0.0.1:5432 | ✓  | PostgreSQL 18.4 | port,binary,brew | postgres://you@127.0.0.1:5432/postgres
1 found in 730 ms · os user you
connect with: perch conn add <name> <url>
```

Press Connect and you are working. Perch never bundles or installs a database of its own.

---

## A workspace that stays out of your way

### Split panes

Drag a tab to any edge to build the layout the task needs, or <kbd>⌘</kbd><kbd>\</kbd> to split
without leaving the keyboard. Panes resize, and the layout survives a reload.

<p align="center">
  <img src="docs/assets/hero.png" alt="Perch with a file open on the left, a notebook on the right, and results below" width="900">
</p>

<p align="center">
  <sub>A file on the left, a notebook on the right, results below. One window.</sub>
</p>

### SQL notebooks

Sometimes a single query isn't enough. **New notebook** turns the editor into a column of cells you
run independently — each keeping its own result and its own execution time, which is how you put
two versions of a query side by side and read the difference.

```sql
-- Query 1
SELECT * FROM orders LIMIT 20;

-- Query 2
SELECT status, COUNT(*) FROM orders GROUP BY status;
```

Cells are just statements, so there is no new format to adopt. Save it and you have a plain `.sql`
file that runs in `psql` unchanged.

> [!NOTE]
> Boundaries can be set explicitly with `-- %%`. Notebook view is not remembered yet — reopen a
> saved notebook and you get the script editor; the `-- %%` markers survive, the view does not.

### Schema-aware from editor to result

The schema explorer and the editor share the same database metadata. Start typing:

```sql
SELECT * FROM ord...
```

and Perch completes the actual tables and columns in your connected database, each labelled with
its type. A rejected query gets a squiggle under the exact token the server objected to, with the
message on hover.

### Your folders, your files

Point Perch at a directory and it works on the `.sql` files already in it. No import step, no
library, no second copy. Open several folders at once — they are your workspaces, and also the
boundary of what the server may read or write.

* Files open and save **in place**, so your editor, your repo and Perch see the same bytes
* Changed on disk while open? Detected — adopted if you have no edits, offered as a choice if you do
* Autosave, with a delay you set, or off
* Recent folders one click away

### Move without the mouse

<kbd>⌘</kbd><kbd>K</kbd> opens one palette over your open files, saved connections, databases on the
current server, and every table in the schema. Selecting a connection connects; selecting a database
switches.

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

---

## GUI + CLI

Perch gives you two ways into the same workspace.

### Terminal

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

### GUI

```console
$ perch
```

The CLI and the UI share **connections, SQL files, history and settings**, so you can move between
them without keeping two workflows in your head.

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

`perch run` talks to the driver directly — nothing to boot, nothing left running when it is done.
Perfect for scripts, Makefiles and CI.

---

## Local by design

Everything Perch keeps lives in plain files you can read:

```text
~/.perch/
├── connections.json    saved connections, incl. passwords (mode 0600)
├── settings.json       autosave, maxRows, workspaces, theme
├── history.jsonl       append-only run history (no result rows on disk)
├── server.json         pid/url of the running server (mode 0600)
└── queries/            your .sql files, opened as the first workspace
```

**No telemetry. No cloud sync. No phoning home.** Your SQL files stay where they already are, and
`PERCH_HOME` moves the whole directory if you want it elsewhere.

> [!WARNING]
> Saved credentials are stored in `~/.perch/connections.json`. The file is permission-restricted,
> but it is **not a secrets vault** — don't commit or sync it.

> [!WARNING]
> The server binds to `127.0.0.1` and has **no login**: loopback is the security boundary, so
> anything that can reach the port can run queries. `perch serve --host <addr>` past localhost
> hands the API to everyone on that network, and says so when it starts.

---

## One binary. That's it.

```sh
chmod +x perch
mv perch /usr/local/bin/perch

perch
```

**[Download the latest release →](https://github.com/Sahil1337/perch/releases)**

No Electron runtime. No bundled database. No extra service to install.

> [!NOTE]
> macOS may quarantine downloaded binaries. If Gatekeeper blocks Perch:
>
> ```sh
> xattr -d com.apple.quarantine /usr/local/bin/perch
> ```

---

## Status

> [!WARNING]
> **Perch is early-stage software.**

| Component | Status |
| --- | --- |
| CLI | Stable |
| HTTP API | Complete |
| Web UI | Active development |
| Cross-platform releases | Manual for now |

Postgres and MySQL are supported. The driver interface is deliberately small, so another SQL
dialect is contained work rather than a rewrite — SQLite and SQL Server are not there today.

If something feels wrong, [open an issue](https://github.com/Sahil1337/perch/issues).

---

## Questions

<details>
<summary><strong>Why not pgAdmin?</strong></summary>

<br>

Perch isn't trying to replace database administration tools. Reach for pgAdmin when you need roles,
replication, backups, maintenance or server configuration.

Perch focuses on a smaller loop: **look at the schema → write SQL → inspect the result → leave.**

Use whichever fits the job.

</details>

<details>
<summary><strong>Why isn't SQLite supported?</strong></summary>

<br>

Not yet. Perch targets PostgreSQL and MySQL today. The database layer sits behind a driver
interface, so adding a dialect is isolated work.

See [CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to add one.

</details>

---

## Contributing

Perch is still taking shape. Ideas for another driver, a better SQL workflow, editor improvements,
schema exploration, CLI features or UI work are all welcome.

**[Contributing guide →](CONTRIBUTING.md)**

---

<div align="center">
<sub><strong>MIT</strong> © <a href="https://github.com/Sahil1337">Sahil1337</a> · <a href="https://github.com/Sahil1337/perch/issues">Issues</a> · <a href="CONTRIBUTING.md">Contributing</a></sub>
</div>
