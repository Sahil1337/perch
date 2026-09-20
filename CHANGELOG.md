# Changelog

Notable changes to perch. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [semantic versioning](https://semver.org/).

The section matching a release's version becomes that release's notes on GitHub — see
[CONTRIBUTING.md](CONTRIBUTING.md#cutting-a-release).

[Unreleased]: https://github.com/Sahil1337/perch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Sahil1337/perch/releases/tag/v0.1.0

## [Unreleased]

### Added

- **`perch update`** — replaces the running binary with the latest release: downloads this
  platform's asset, verifies it against the release's `checksums.txt`, and renames it into place.
  `--check` reports without installing, `--version <tag>` pins an exact tag (including an older
  one), and nothing under `~/.perch` is touched. A download that cannot be verified is refused.
- `perch serve` looks for a newer release in the background, at most once a day, and prints one
  line when there is one. It never delays startup or installs anything on its own;
  `PERCH_NO_UPDATE_CHECK=1` turns it off.

### Added

- **Password prompts on the connection you were opening.** A server that answers but asks for a
  password now grows a password field on its own row — in the first-run screen and on saved
  connections alike — instead of throwing you back to a blank form.
- **A "Paste a connection URL" way in** on the first-run screen, and a **Connect over TLS** switch
  in the connection form, for databases discovery cannot find: Neon, Supabase, RDS and anything
  else reached over the network.

### Changed

- **Connection failures say which of the six things went wrong** — no password, wrong password,
  unknown user, unknown database, nothing listening, or a TLS disagreement — in place of the
  driver's own text with its SQLSTATE attached.
- **TLS is on by default for a database that is not on this machine**, and its certificate is
  verified. A `sslmode` in a pasted URL is honoured as written rather than flattened to "on",
  and connections now time out instead of hanging on an unreachable host.
- **Docker containers are offered with the login the image was started with** (`POSTGRES_USER`,
  `POSTGRES_DB`, `MYSQL_DATABASE`), not the OS user, which no container has an account for. The
  probe also finds the CLI outside `PATH`, reads podman and nerdctl, and handles a database
  published on a non-default port.

### Fixed

- **Connect from the first-run screen silently opening the wrong connection.** A failed dial
  reported success, played the handover animation and landed in the workspace pointed at whatever
  was already selected. It now reports the failure and stays put.
- **A second press of Connect failing with "a connection named postgres-local already exists".**
  Discovered servers are named after the container or the port, and a row whose address is already
  saved reuses that connection rather than saving another.
- **The saved-connections list vanishing when a dial failed**, at the moment it was needed.

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
