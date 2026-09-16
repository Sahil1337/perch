<div align="center">

<img src="apps/web/app/icon.svg" alt="Perch" width="76" height="76">

# Perch

**A fast, local SQL client for Postgres and MySQL.**

_Land on your database, look around, leave._

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Postgres](https://img.shields.io/badge/postgres-supported-336791?logo=postgresql&logoColor=white)](#what-it-does)
[![MySQL](https://img.shields.io/badge/mysql-supported-4479A1?logo=mysql&logoColor=white)](#what-it-does)
[![Status: early](https://img.shields.io/badge/status-early-orange.svg)](#status)

</div>

![The Perch workspace](docs/assets/hero.png)

---

## The two-minute wait

You want to know whether the `orders` table has a `status` column.

So you open pgAdmin. It starts a server. It warms up a browser app. It restores your workspace,
reconnects your saved connections, and somewhere on the far side of all that you finally get a tree
you can expand. Four clicks later: yes, `status` is there. It's `text`.

pgAdmin is a good tool built for people **administering** databases — roles, vacuum, replication,
backups. Most days you are not administering anything. You just want to look at a table.

**Perch is for the other 90% of the time.** It opens instantly, finds the database already running
on your machine, shows you the schema, runs your query, and gets out of the way.

## It finds your database for you

There is no "paste a connection string" wall on first run. Perch looks for what is already
installed or listening — a default port, a Homebrew or systemd service, a Docker container, a
binary on your `PATH` — and offers to connect to it.

```console
$ perch discover
dialect  | address        | up | version         | sources          | suggested url
---------+----------------+----+-----------------+------------------+-----------------------------------------
postgres | 127.0.0.1:5432 | ✓  | PostgreSQL 16.2 | port,binary,brew | postgres://you@127.0.0.1:5432/postgres
mysql    | 127.0.0.1:3306 |    | MySQL 8.4.0     | binary           | mysql://you@127.0.0.1:3306
2 found in 462 ms · os user you
connect with: perch conn add <name> <url>
```

Press Connect and you are in. Perch never bundles or installs a database of its own.

## What it does

A screenshot per idea, then the rest in a table.

### Split the editor

![Split panes](docs/assets/split-panes.png)

Drag a tab to any edge of a pane and it splits — left, right, top, bottom, as deep as you like.
**⌘\** splits the focused pane without leaving the keyboard. Panes resize, the layout survives a
reload, and every editor stays mounted, so switching tabs never costs you a cursor position or a
scroll offset.

Two queries open side by side, one schema, one connection. The results pane is shared: running in
either pane replaces what is shown, and you compare by re-running or by reaching for a notebook.

### Notebooks, without a new format

![SQL notebook](docs/assets/notebook.png)

**New notebook** in the Files panel gives you a column of runnable cells instead of one long
buffer. Each cell runs on its own with **⌘↵** and keeps **its own result and its own
`N rows · N ms`**, stacked down the page — which is how you put two versions of a query next to
each other and read the difference. Run-all walks them in order, with a Cancel.

Cells are just statements, so there is no new file format: save the notebook and you get a plain
`.sql` file that runs in `psql` unchanged. Add a `-- %%` comment if you want to draw the boundaries
yourself — to keep a `begin; … commit;` in one cell, say. Outputs are never written to disk.

> [!NOTE]
> Notebook view is not yet remembered. Reopen a saved notebook and it comes back in the script
> editor; the `-- %%` markers survive, the view does not.

### It knows your schema

![Schema and autocomplete](docs/assets/schema.png)

The tree goes schema → table → column, with driver types, nullability, primary keys, row estimates
and a search box. It refreshes on demand, and on its own after a statement that changes the shape
of things.

The same schema drives completion in the editor: real table and column names from the database you
are connected to right now, each column showing its type, primary keys marked. CodeMirror 6
underneath, in the dialect of the connection — a failed query gets a squiggle under the exact token
the server objected to, with the message on hover.

### The rest

|                                   |                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres and MySQL**            | One connection format, one set of commands, two dialects.                                                                          |
| **Run what you mean**             | **⌘↵** runs the selection, or the statement under the cursor if there is none. **⌘⇧↵** runs the whole file.                         |
| **Cancel a runaway**              | Run turns into Cancel while a query is in flight, and the server cancels it at the driver.                                          |
| **Multi-statement scripts**       | Run the file; every statement gets its own tab, its own row count and its own timing.                                              |
| **A results grid, not a table**   | Virtualized to any row count, fully keyboard-navigable, types in the headers, `null` visibly distinct from empty, ⌘C to copy.       |
| **Honest truncation**             | Hit the row cap and it says so, in the grid and in the messages.                                                                    |
| **Exports**                       | CSV from the results pane; the CLI also writes JSON, NDJSON and formatted tables.                                                  |
| **Your `.sql` files, in place**   | Point Perch at a directory and it browses, opens and saves the files already there.                                                |
| **Edited elsewhere? Noticed.**    | A file changed on disk while you had it open is detected — adopted silently if you have no edits, offered as a choice if you do.    |
| **History that survives restarts**| Grouped by day; click any run to bring its rows and timing back.                                                                    |
| **Keyboard-first**                | ⌘K palette over files, connections, databases and tables; ⌘B, ⌘J, ⌘S, ⌘, for the rest.                                             |
| **No flash of the wrong theme**   | Dark or light, stored on the server so every browser agrees, painted before first frame.                                            |

## Two doors, one house

Perch is a UI **and** a CLI, and neither is a second-class port of the other.

```console
$ perch conn add local postgres://you@localhost:5432/shop
$ perch conn test local
ok · PostgreSQL 16.2 on x86_64-pc-linux-gnu · 11 ms

$ perch run local -e "select status, count(*) from orders group by 1"
status   | count
---------+------
paid     |  1204
refunded |    37
2 rows · 8 ms

$ perch serve
perch v0.1.0 → http://127.0.0.1:4600
```

A connection you add in the terminal is waiting for you in the UI. Queries you run in the browser
show up in `perch history`. Same state, same files — your choice of door.

`perch run` talks to the driver **directly**: nothing to boot, nothing left running when it is
done. It pipes, it scripts, and it lives in a Makefile perfectly happily.

```sh
cat report.sql | perch run prod - --format csv > out.csv
```

## Install

Perch ships as a single self-contained binary — nothing to install alongside it. Grab the one for
your platform from [Releases](https://github.com/Sahil1337/perch/releases), make it executable, and
put it on your `PATH`:

```sh
chmod +x perch && mv perch /usr/local/bin/
perch
```

Running `perch` with no arguments starts the server and opens the UI.

> [!NOTE]
> macOS quarantines downloaded binaries. If Gatekeeper refuses to run it:
> `xattr -d com.apple.quarantine /usr/local/bin/perch`

## Usage

```sh
perch                                                      # start the server and open the UI
perch discover                                             # what's already on this machine?
perch conn add local postgres://user:pass@host/db --test   # save a connection
perch conn ls                                              # list them (passwords never printed)
perch conn test local                                      # round-trip, with latency
perch schema local --table public.orders                   # look at a table
perch run local query.sql --format csv                     # run a file
cat q.sql | perch run local -                              # or a pipe
perch history --limit 20 --conn local                      # what did I run yesterday?
perch conn dbs local                                       # databases on that server
perch files ls ~/sql                                       # .sql files in a directory
perch settings get / perch settings set theme light        # read or change local settings
perch serve --port 4600 --dir ~/sql                        # UI + API on a chosen port
perch status                                               # is a server running?
perch stop                                                 # done
```

Every command takes `--help`. Every command that prints data takes `--json`.

**[Full CLI and HTTP reference →](apps/server/README.md)**

## Your data stays yours

No account. No telemetry. No cloud. No phoning home. Everything Perch keeps lives in plain files
under `~/.perch` — nowhere else — and you can open and read every one of them:

```
~/.perch/
  connections.json   saved connections, incl. passwords (mode 0600)
  settings.json      autosave, maxRows, workspaces, theme, ...
  history.jsonl      append-only run history (no result rows kept on disk)
  server.json        pid/url of the running server (mode 0600), if any
  queries/           your .sql files, created on first run and opened as the first workspace
```

`PERCH_HOME` moves the whole directory somewhere else. `perch serve --dir <path>` adds more
workspace folders; `~/.perch/queries` is simply the one that is always there.

The server binds to `127.0.0.1`. There is no login and no shared secret: loopback _is_ the
boundary, so anything that can reach the port can run queries. `perch serve --host <addr>` past
localhost hands the API to everyone on that network, and says so when it starts.

> [!WARNING]
> **Passwords are stored in plain JSON** in `connections.json`. That is a reasonable trade for a
> local dev tool, but it is not a secrets vault — do not commit that file or sync it anywhere.

## FAQ

<details>
<summary><b>Should I throw away pgAdmin?</b></summary>

<br>

Probably not. If you are managing roles, tuning autovacuum, inspecting replication slots or
restoring a backup, reach for pgAdmin — it is built for that and Perch is not. Perch is for the
daily loop: _look at the schema, run a query, read the rows, move on._ Keep both; you will just
open Perch far more often.

</details>

<details>
<summary><b>Why is there a CLI at all? I wanted a GUI.</b></summary>

<br>

Because half the time the fastest path to an answer is one line in a terminal you already have
open, and because a GUI cannot be piped into `grep`, committed to a repo, or run in CI. The two
share one set of connections and one history, so using both costs you nothing.

</details>

<details>
<summary><b>Does it support SQLite / SQL Server / MongoDB?</b></summary>

<br>

Not today — Postgres and MySQL. Both sit behind one small driver interface, so a third dialect is a
contained piece of work rather than a rewrite. If you want to add one,
[CONTRIBUTING.md](CONTRIBUTING.md) is the place to start.

</details>

<details>
<summary><b>Is it actually fast, or just "fast for an Electron app"?</b></summary>

<br>

There is no Electron. The CLI connects and exits; `perch serve` is a small local HTTP server,
and the UI it serves is a static bundle compiled into the binary.

Two things keep big results cheap rather than fast-for-a-GUI: the server caps rows per statement
at `maxRows` before they ever reach the browser, and the grid virtualizes what it does receive, so
a million-row table costs the same to scroll as a hundred-row one. Results are fetched per run
rather than streamed row by row — the streaming route exists in the API, but the UI does not use
it today.

</details>

<details>
<summary><b>Can my team share a Perch server?</b></summary>

<br>

It is not built for that. Perch is a local tool with no authentication — loopback is the security
boundary. `--host` exists for reaching it from a VM or container you control, not for putting it on
a shared network.

</details>

## Status

Early, and honest about it.

- **CLI** — complete and stable.
- **HTTP API** — complete. [Documented here](docs/api/http.md).
- **Web UI** — built and wired to the API, compiled into the binary and served at the address
  `perch serve` prints. Rough edges remain. The screenshots above are placeholders until the
  surfaces they show stop moving.
- **Releases** — binaries are built by hand today; the workflow that attaches them per platform is
  not written yet.

Expect the UI to move. The CLI is settled.

## Contributing

Issues and PRs are welcome — especially a third driver, or an opinion on the UI direction.
[CONTRIBUTING.md](CONTRIBUTING.md) covers getting set up, the repo layout, and what a change has to
clear before it lands.

## License

[MIT](LICENSE) © [Sahil1337](https://github.com/Sahil1337)

<div align="center">
<br>
<sub>If Perch saved you a loading screen today, a star is a nice way to say so.</sub>
</div>
