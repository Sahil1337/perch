# Changelog

Notable changes to perch. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/).

The section matching a release's version becomes that release's notes on GitHub — see
[CONTRIBUTING.md](CONTRIBUTING.md#cutting-a-release).

[0.2.0]: https://github.com/Sahil1337/perch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Sahil1337/perch/releases/tag/v0.1.0

## [0.2.0] — 2026-09-22

### Added

- **`perch update`** — updates the binary in place from the latest release, verified against its
  checksum. `--check` reports without installing, `--version <tag>` pins one. `perch serve` also
  mentions a newer release once a day; `PERCH_NO_UPDATE_CHECK=1` turns that off.
- **Password prompts on the row you pressed.** A server that asks for a password gets a password
  field in place, rather than sending you back to an empty form.
- **Paste a connection URL** on the first-run screen, and a **Connect over TLS** switch in the
  connection form — for Neon, Supabase, RDS and anything else discovery cannot find.
- **Run history keeps results.** Settings → History chooses what a run leaves behind: nothing, the
  query, or the query and its rows. Kept rows mean an old run reopens with its data and a working
  export, instead of a row count and a dead link.
- **History is scoped to the folder you are working in**, with a picker for this folder, every run,
  or the ones belonging to no folder.
- The query that produced a result is shown above it; right-clicking a history row offers Run again
  and Copy SQL.

### Changed

- Connection failures say which of six things went wrong: no password, wrong password, unknown
  user, unknown database, nothing listening, or a TLS disagreement.
- TLS is on and verified by default for a database that is not on this machine, and an `sslmode` in
  a pasted URL is honoured as written. Connections time out rather than hanging.
- Docker containers are offered with the login their image was started with instead of your OS
  user, which no container has an account for. podman and nerdctl are read too.
- Run history is kept in `history.db` rather than an ever-growing `history.jsonl`, which is
  imported the first time the new store opens.

### Fixed

- Connect on the first-run screen silently opening a different connection.
- A second press of Connect failing with "a connection named postgres-local already exists".
- The saved-connections list vanishing when a dial failed.
- A long hostname pushing Connect off the end of a saved-connection row.
- "Connect a database…" in the connection picker doing nothing after the first run.
- The wire on the first-run screen sitting slightly below the marks it joins.

## [0.1.0] — 2026-09-19

First release. Perch is a local SQL workspace for PostgreSQL and MySQL: one self-contained
binary, around 14 MB, with no runtime to install alongside it and no account or cloud service.

### Added

- **Schema-aware SQL editor** — the schema tree feeds completions and dialect-aware
  highlighting, and database errors map back to the exact position in your query.
- **Relationship View** — foreign keys drawn as an interactive diagram, with large tables
  collapsing to a keys-only view.
- **Query Walk** — a `SELECT` replayed stage by stage (`FROM` → `JOIN` → `WHERE` → `GROUP BY` →
  … → `LIMIT`), showing the rows your database returned at each step. Read-only.
- **SQL notebooks** — any `.sql` file splits into independently runnable statements, each
  keeping its own results, and stays valid SQL outside perch.
- **Workspace folders** — open a directory and edit the `.sql` files in place. External changes
  are detected, multiple folders can be open, and tabs are restored between sessions.
- **Split panes**, a **virtualized result grid** with CSV and JSON export, **query history**
  that survives restarts, and a **command palette** over commands, files, connections,
  databases and tables.
- **Server discovery** — finds PostgreSQL and MySQL already running on your machine through
  open ports, binaries on `PATH`, Homebrew, systemd, Windows services and Docker. Perch never
  installs or bundles a database.

### Install

`curl -fsSL https://raw.githubusercontent.com/Sahil1337/perch/main/install.sh | sh` on macOS and
Linux, or download the Windows `.exe` from the assets on this release.
See the [README](https://github.com/Sahil1337/perch#install).

### Known limitations

- **The binaries are not signed.** Installing with the `curl` line above avoids this, because
  macOS only quarantines files a browser downloaded. If you download from this page instead,
  macOS will say the developer cannot be verified — clear it with
  `xattr -d com.apple.quarantine ./perch`. Windows shows a SmartScreen warning: **More info →
  Run anyway**.
- Result rows are never written to history; only the shape, counts and timing are kept.
