# Changelog

Notable changes to perch. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/).

The section matching a release's version becomes that release's notes on GitHub — see
[CONTRIBUTING.md](CONTRIBUTING.md#cutting-a-release).

[Unreleased]: https://github.com/Sahil1337/perch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Sahil1337/perch/releases/tag/v0.1.0

## [Unreleased]

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
