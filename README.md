<div align="center">

<img src="apps/web/app/icon.svg" alt="Perch" width="72">

# Perch

<p><strong>A lightweight SQL workspace for developers.</strong></p>

<p>
PostgreSQL · MySQL · Local-first · SQL notebooks · CLI
</p>

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
  <img src="docs/assets/demo.gif" alt="Writing a query in Perch, running it, and reading the results" width="820">
</p>

## What is Perch?

Perch is a lightweight SQL workspace for developers who spend their time **writing, exploring, and understanding SQL**.

It brings schema exploration, SQL editing, query execution, results, and database visualization into one focused workspace.

Perch works with PostgreSQL and MySQL databases already running on your machine. Your SQL files stay on disk as normal `.sql` files, while Perch provides the tools around them.

**No account. No cloud service. No bundled database.**

## Features

### Schema-aware SQL editor

Write SQL with your database schema directly in context.

The schema sidebar shows tables, views, materialized views, columns, types, nullability, primary keys, and row estimates. The editor uses the same metadata for completions and dialect-aware syntax highlighting.

Database errors are mapped back to the exact location in your query.

<p align="center">
  <img src="docs/assets/schema-editor.png" alt="Perch schema tree and SQL editor" width="748">
</p>

Run the statement under your cursor with <kbd>⌘</kbd><kbd>↵</kbd>, or the entire file with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>↵</kbd>.

---

### Relationship View

**See how your database fits together.**

Relationship View turns foreign-key relationships into an interactive schema diagram. Tables show their columns and keys, while relationships are drawn between the tables they connect.

Click to focus on a table, drag to rearrange the layout, and zoom or pan around larger schemas.

<p align="center">
  <img src="docs/assets/relationship-view.png" alt="Perch relationship view showing connected database tables" width="748">
</p>

Large tables automatically switch to a compact keys-only view, keeping the diagram readable.

---

### Query Walk

**See how a SQL query produces its result.**

Query Walk visualizes a `SELECT` step by step through its major stages:

```text
FROM → JOIN → WHERE → GROUP BY → HAVING
→ WINDOW → SELECT → DISTINCT → ORDER BY → LIMIT
```

At each stage, Perch shows the rows returned by your database and explains what happened.

This makes complex SQL easier to understand, debug, and explain — especially joins, filtering, aggregation, window functions, subqueries, `CASE`, and set operations.

<p align="center">
  <img src="docs/assets/query-walk.gif" alt="Perch Query Walk visualizing SQL execution" width="748">
</p>

The visualization is based on your actual SQL and database. Query Walk uses read-only executions and does not modify your data.

---

### SQL notebooks

Turn any `.sql` file into a notebook.

Each statement can run independently while keeping its own results, row count, and execution time.

```sql
-- Query 1
SELECT *
FROM orders
WHERE status = 'paid'
LIMIT 20;

-- %%

-- Query 2
SELECT *
FROM orders
WHERE status = 'paid'
  AND created_at > now() - interval '7 days';
```

The file remains valid SQL and can still be used outside Perch.

<p align="center">
  <img src="docs/assets/notebook.png" alt="Perch SQL notebook" width="730">
</p>

---

### Workspace folders

Open a directory and work directly with the `.sql` files inside it.

There is no import step or proprietary project format.

- Files open and save in place
- External changes are detected
- Multiple folders can be open
- Tabs and focus are restored between sessions
- Autosave is configurable
- Untitled queries can be saved into a workspace

---

### Split panes

Compare queries and results side by side using a resizable pane layout.

Drag tabs to any edge to create splits, move tabs between panes, and restore the layout when you return.

<p align="center">
  <img src="docs/assets/hero.png" alt="Perch split-pane SQL workspace" width="780">
</p>

---

### Result grid

Inspect query results in a fast, virtualized grid.

- Typed column headers
- Row counts and execution time
- Distinct `NULL` representation
- Grid and text views
- CSV export
- Clipboard copying
- Separate result tabs for multi-statement queries
- Server messages and notices

<p align="center">
  <img src="docs/assets/results.png" alt="Perch query result grid" width="750">
</p>

---

### Query history

Every query run from the UI or CLI is stored in local history.

History survives restarts and records the SQL, outcome, row count, and execution time.

**Result rows are never stored in history.**

<p align="center">
  <img src="docs/assets/history.png" alt="Perch query history" width="355">
</p>

---

### Command palette

Press <kbd>⌘</kbd><kbd>K</kbd> to search Perch without leaving the keyboard.

Search across:

- Commands
- Open files
- Connections
- Databases
- Tables

Switching connections or databases automatically updates the schema and editor context.

<p align="center">
  <img src="docs/assets/command-palette.png" alt="Perch command palette" width="635">
</p>

## Installation

Download the latest binary for your platform from [Perch Releases](https://github.com/Sahil1337/perch/releases).

```sh
chmod +x perch
mv perch /usr/local/bin/perch
```

On macOS, Gatekeeper may quarantine downloaded binaries:

```sh
xattr -d com.apple.quarantine /usr/local/bin/perch
```

To build from source, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Getting started

Start Perch:

```sh
perch
```

On first launch, choose a workspace, connection, and database.

Perch can discover database servers already running on your machine, including PostgreSQL and MySQL installations exposed through local ports, binaries on `PATH`, Homebrew, systemd, Windows services, and Docker.

```console
$ perch discover

dialect  | address        | up | version         | sources          | suggested url
---------+----------------+----+-----------------+------------------+---------------------------------------
postgres | 127.0.0.1:5432 | ✓  | PostgreSQL 18.4 | port,binary,brew | postgres://you@127.0.0.1:5432/postgres

1 found in 730 ms · os user you
```

Perch never installs or bundles a database server.

## CLI

Perch includes a CLI for scripts, automation, and CI.

The CLI and UI share connections, files, history, and settings.

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

`perch run` connects directly to the database without starting the Perch server. It exits non-zero on SQL errors, making it suitable for scripts and CI.

### Common commands

```sh
perch                              # Start Perch
perch discover                     # Discover local databases

perch conn add <name> <url>        # Save a connection
perch conn ls                      # List connections
perch conn test <name>             # Test a connection
perch conn dbs <name>              # List databases
perch conn rm <name>               # Remove a connection

perch schema <conn>                # Inspect schema

perch run <conn> query.sql         # Execute a SQL file
perch run <conn> -e "SELECT 1"     # Execute SQL
cat query.sql | perch run <conn> - # Execute stdin

perch history --limit 20
perch files ls ~/sql

perch settings get
perch settings set <key> <value>

perch serve --port 4600 --dir ~/sql
perch status
perch stop
```

Every command supports `--help`. Commands that output data also support `--json`.

**[Full CLI and HTTP API reference →](apps/server/README.md)**

## Keyboard shortcuts

| Shortcut                             | Action                    |
| ------------------------------------ | ------------------------- |
| <kbd>⌘</kbd><kbd>↵</kbd>             | Run selection / statement |
| <kbd>⌘</kbd><kbd>⇧</kbd><kbd>↵</kbd> | Run entire file           |
| <kbd>⌘</kbd><kbd>K</kbd>             | Command palette           |
| <kbd>⌘</kbd><kbd>B</kbd>             | Toggle sidebar            |
| <kbd>⌘</kbd><kbd>J</kbd>             | Toggle results            |
| <kbd>⌘</kbd><kbd>S</kbd>             | Save                      |
| <kbd>⌘</kbd><kbd>&#92;</kbd>         | Split pane                |
| <kbd>⌘</kbd><kbd>,</kbd>             | Settings                  |
| <kbd>⇧</kbd><kbd>⌥</kbd><kbd>F</kbd> | Format SQL                |

Use <kbd>Ctrl</kbd> instead of <kbd>⌘</kbd> on Windows and Linux.

## Local-first

Perch runs locally and keeps your workspace on your machine.

```text
~/.perch/
├── connections.json
├── settings.json
├── history.jsonl
├── server.json
└── queries/
```

`PERCH_HOME` can be used to relocate this directory.

Perch sends no telemetry and does not require a remote service for normal operation.

## Contributing

Perch is a Bun workspace monorepo.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, project structure, scripts, and verification.

Bug reports and feature requests: [GitHub Issues](https://github.com/Sahil1337/perch/issues).

## License

MIT © Sahil1337
