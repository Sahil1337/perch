# Changelog

Notable changes to perch. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/).

The section matching a release's version becomes that release's notes on GitHub — see
[CONTRIBUTING.md](CONTRIBUTING.md#cutting-a-release).

[0.2.0]: https://github.com/Sahil1337/perch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Sahil1337/perch/releases/tag/v0.1.0

## [0.2.0] — 2026-09-22

### Added

- **`perch update`** — Update Perch to the latest release from the command line. The update is
  verified using a checksum before installing. Use `--check` to only check for updates or
  `--version <tag>` to install a specific version. `perch serve` also checks for new releases once
  a day. Set `PERCH_NO_UPDATE_CHECK=1` to disable this.
- **Easier database connections** — You can now paste a connection URL on the first-run screen and
  use the **Connect over TLS** option when connecting to databases such as Neon, Supabase, or RDS.
- **Inline password prompts** — If a database asks for a password, the password field now appears
  directly on the connection you selected.
- **Better run history** — You can choose what Perch saves for each run: nothing, the query, or the
  query and its results. Saved results can be opened and exported again later.
- **Folder-based history** — History can now be filtered to the current folder, all folders, or
  runs that don't belong to a folder.
- **History actions** — The SQL query that produced a result is shown above it. You can also
  right-click a history item to **Run again** or **Copy SQL**.

### Changed

- **Clearer connection errors** — Connection errors now explain what went wrong, such as a missing
  or wrong password, unknown user or database, no server listening, or a TLS problem.
- **Safer remote connections** — TLS is now enabled and verified by default for databases running
  on another machine. If a connection URL includes `sslmode`, Perch follows that setting.
  Connections also time out instead of waiting forever.
- **Better container connections** — Docker, Podman, and nerdctl connections now use the username
  configured for the container instead of your OS username.
- **Better history storage** — Run history is now stored in `history.db` instead of
  `history.jsonl`. Existing history is automatically imported the first time the new database is
  opened.

### Fixed

- Connecting from the first-run screen could open a different connection than the one selected.
- Pressing **Connect** a second time could fail with `a connection named postgres-local already
  exists`.
- Saved connections could disappear after a failed connection attempt.
- Long hostnames could push the **Connect** button off the edge of a saved connection.
- **Connect a database…** stopped working after the first run.
- The connection wire on the first-run screen was slightly misaligned with the marks it connects.

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
