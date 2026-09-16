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
  <img src="docs/assets/demo.gif" alt="Typing a query in Perch, formatting it, running it, and reading 12 rows back in 7 milliseconds" width="880">
</p>

---

## Why

You wanted to check one thing. So you open pgAdmin, and it opens a tree of roles, tablespaces and
foreign data wrappers. Four levels down to `orders`, a query tool in another tab, a reconnect after
switching database — and the thing you wanted to check is gone from your head. Workbench is the same
trade in a different font.

Those are administration tools. Most days you are not administering a database, you are **reading**
one. Perch is built for that:

```text
Connect → look at the schema → write SQL → read the result → leave
```

No account, no cloud, no bundled database, no Electron. One binary, and a UI quiet enough to think
in.

---

## Small, not bare

Minimal is about what's on screen, not what it can do.

<table>
<tr>
<td width="50%" valign="top">

**📓 SQL notebooks**

Jupyter's idea, no new file format. Cells run on their own and keep their own rows and timing. Save
it and it's a plain `.sql` file that runs in `psql`.

</td>
<td width="50%" valign="top">

**🪟 Split panes**

Drag a tab to an edge, or <kbd>⌘</kbd><kbd>\</kbd>. Rewrite on the left, original on the right, both
timings side by side. The layout survives a reload.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🗂 Workspaces**

Open a folder like you would in your editor. Files save **in place**, external edits are detected,
autosave optional. Several folders at once.

</td>
<td width="50%" valign="top">

**🕓 History**

Every run kept, grouped by day, still there after a restart. Click one to bring it back. Rows are
never written to disk.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🧠 Live schema**

Tables, types, keys and row counts in the sidebar; completions from the real database in the editor;
a squiggle on the exact token the server rejected.

</td>
<td width="50%" valign="top">

**🔀 Boring database switching**

<kbd>⌘</kbd><kbd>K</kbd>, type the name, <kbd>↵</kbd>. Schema, completions and editor follow. No
reconnect dance, no stale tree.

</td>
</tr>
</table>

<p align="center">
  <img src="docs/assets/hero.png" alt="Perch with a file open on the left, a notebook on the right, and results below" width="900">
</p>

Plus the things you only notice when they're missing: a virtualized grid that scrolls the same at
100k rows, `NULL` distinct from empty, CSV export, cancel that cancels at the driver, and formatting
on <kbd>⇧</kbd><kbd>⌥</kbd><kbd>F</kbd> only — never behind your back on save.

| | |
| --- | --- |
| <kbd>⌘</kbd><kbd>↵</kbd> | Run the selection, or the statement at the cursor |
| <kbd>⌘</kbd><kbd>⇧</kbd><kbd>↵</kbd> | Run the whole file |
| <kbd>⌘</kbd><kbd>K</kbd> | Palette — files, connections, databases, tables |
| <kbd>⌘</kbd><kbd>B</kbd> / <kbd>⌘</kbd><kbd>J</kbd> | Sidebar / results |
| <kbd>⌘</kbd><kbd>S</kbd> · <kbd>⌘</kbd><kbd>\</kbd> · <kbd>⌘</kbd><kbd>,</kbd> | Save · split · settings |

On Windows and Linux, <kbd>Ctrl</kbd> throughout.

> [!NOTE]
> **Next up:** a relationship view — tables drawn with the keys that join them, so an unfamiliar
> schema explains itself.

---

## Getting in

```sh
chmod +x perch && mv perch /usr/local/bin/perch
perch
```

**[Download →](https://github.com/Sahil1337/perch/releases)** · macOS may quarantine it:
`xattr -d com.apple.quarantine /usr/local/bin/perch`

Perch finds the Postgres or MySQL already running on your machine — default ports, `PATH`, Homebrew,
systemd, Windows services, Docker — and offers it on first run. It never bundles a database.

```console
$ perch discover
postgres | 127.0.0.1:5432 | ✓ | PostgreSQL 18.4 | port,binary,brew
```

---

## Also a CLI

Same connections, same files, same history — without leaving the shell.

```console
$ perch conn add local postgres://user:pass@localhost:5432/shop
$ perch run local -e "select status, count(*) from orders group by 1"
status   | count
---------+------
paid     |  1204
2 rows · 8 ms
```

`perch run` talks to the driver directly — nothing to boot, nothing left running, exit 1 on a SQL
error. Good for scripts and CI. `--format table|json|csv|ndjson`.

<details>
<summary>All commands</summary>

<br>

```sh
perch                                  # start the server and open the UI
perch discover                         # what's already on this machine?
perch conn add|ls|rm|test|dbs <name>   # connections (passwords never printed)
perch schema <conn> --table public.orders
perch run <conn> query.sql --format csv
perch history --limit 20
perch files ls ~/sql
perch settings get|set
perch serve --port 4600 --dir ~/sql · perch status · perch stop
```

`--help` on everything, `--json` where there's data. **[Full CLI & API →](apps/server/README.md)**

</details>

---

## Local by design

Everything lives in plain files under `~/.perch` — connections, settings, history, your `.sql`
queries. **No telemetry, no cloud sync, no phoning home.**

> [!WARNING]
> Passwords sit in `~/.perch/connections.json` (mode 0600, not a secrets vault — don't commit it),
> and the server binds to `127.0.0.1` with **no login**: loopback is the security boundary.

---

## Status

**Early software.** CLI and HTTP API are stable; the UI is in active development. Postgres is the
best-travelled path, MySQL is supported and less exercised. Not done yet: notebook view isn't
remembered across reopen, foreign keys aren't introspected, passwords aren't in the OS keychain.

Use pgAdmin and Workbench for what they're good at — roles, replication, backups, server config.
Perch is for the loop they make heavy. Different hours of the day.

If something feels wrong, [open an issue](https://github.com/Sahil1337/perch/issues) — "feels wrong"
is a legitimate bug report here. Another driver, editor polish or CLI work all welcome:
**[contributing guide →](CONTRIBUTING.md)**

---

<div align="center">
<sub><strong>MIT</strong> © <a href="https://github.com/Sahil1337">Sahil1337</a></sub>
</div>
