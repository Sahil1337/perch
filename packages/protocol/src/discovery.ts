import type { Dialect } from "./connection.js";

/**
 * A database server found on the user's machine. The app never bundles Postgres or MySQL; it
 * looks for what is already installed or running and offers to connect to it.
 */
export type DiscoveredServer = {
  dialect: Dialect;
  host: string;
  port: number;
  /** Which probe found it; several may agree on the same host:port. */
  sources: DiscoverySource[];
  /** From the binary or the service, when it could be read (`PostgreSQL 16.4`). */
  version?: string;
  /** True when a TCP connect to host:port succeeded. */
  reachable: boolean;
  /** A sensible starting point (`postgres://<os user>@localhost:5432/postgres`); no password. */
  suggestedUrl: string;
  /** Extra detail for the UI: the service name, container name, or binary path. */
  label?: string;
};

export type DiscoverySource =
  | "port"        // something answers on the default port
  | "binary"      // psql / postgres / mysqld found on PATH or in a standard install location
  | "brew"        // `brew services` (macOS)
  | "systemd"     // `systemctl` (Linux)
  | "windows"     // Windows service
  | "docker";     // a running container with a postgres/mysql image

export type DiscoveryResult = {
  servers: DiscoveredServer[];
  /** The OS user, offered as the default database user. */
  osUser: string;
  scannedAt: string;
  /** Milliseconds the scan took; probes run in parallel with short timeouts. */
  durationMs: number;
};
