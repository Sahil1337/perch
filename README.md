<div align="center">

# 🐦 Perch

**A fast, local SQL client for Postgres and MySQL.**

*Land on your database, look around, leave.*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Postgres](https://img.shields.io/badge/postgres-supported-336791?logo=postgresql&logoColor=white)](#what-it-does)
[![MySQL](https://img.shields.io/badge/mysql-supported-4479A1?logo=mysql&logoColor=white)](#what-it-does)
[![Status: early](https://img.shields.io/badge/status-early-orange.svg)](#status)

</div>

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

|  |  |
|---|---|
| **Postgres and MySQL** | One connection format, one set of commands, two dialects. |
| **Streaming results** | Rows render as they arrive. A slow query shows you something *now*, not a spinner and a promise. |
| **Cancel a runaway** | Stop an in-flight query from the UI while it is still running — the server cancels it at the driver, not just in the browser. |
| **Multi-statement scripts** | Run the whole file. Every statement reported on its own. |
| **Schema browsing** | Down to a single table's columns, with types and keys. Cached, and refreshable the moment you have migrated. |
| **Autocomplete that knows your schema** | Table and column completion from the database you are actually connected to. |
| **Split panes and tabs** | Drag a tab to split the editor, the way your IDE does it. |
| **Notebooks, without a new format** | Any `.sql` file opens as a column of runnable cells. It still runs in `psql`. |
| **Your `.sql` files, in place** | Point Perch at a directory; it browses, opens and saves the files already in your project. Edits made outside are picked up, and two tabs cannot clobber each other. |
| **Exports** | CSV, JSON, NDJSON, or a formatted table. |
| **History that survives restarts** | From the UI and the CLI alike — without keeping result rows on disk. |
| **Errors that point** | A squiggle under the exact offending character, and a non-zero exit code. |

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
perch serve --port 4600 --dir ~/sql                        # UI + API on a chosen port
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

The server binds to `127.0.0.1`. There is no login and no shared secret: loopback *is* the
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
daily loop: *look at the schema, run a query, read the rows, move on.* Keep both; you will just
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

There is no Electron. The CLI connects and exits; `perch serve` is a small local HTTP server.
Results stream as they arrive rather than buffering, so time-to-first-row does not depend on how
big the result set turns out to be.

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
  `perch serve` prints. Rough edges remain, and screenshots land once they are sanded off.
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
