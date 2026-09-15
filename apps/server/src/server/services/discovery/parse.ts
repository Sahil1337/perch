// Turning a tool's output into a fact. Every one of these takes text that may be anything at all,
// so an unrecognised shape is `undefined` rather than a throw.

import type { Dialect } from "@perch/protocol";

export function dialectOf(text: string): Dialect | undefined {
  const s = text.toLowerCase();
  if (s.includes("postgres")) return "postgres";
  if (s.includes("mysql") || s.includes("mariadb")) return "mysql";
  return undefined;
}

/**
 * `psql (PostgreSQL) 16.4` → `PostgreSQL 16.4`; `mysqld  Ver 8.4.0 for macos14` → `MySQL 8.4.0`;
 * a MariaDB build of the same binary keeps its own name.
 */
export function parseVersion(output: string): string | undefined {
  const pg = /postgresql\)?\s+v?(\d[\w.+-]*)/i.exec(output);
  if (pg) return `PostgreSQL ${pg[1]}`;
  const my = /\bVer\s+v?(\d[\w.-]*)/i.exec(output);
  if (my) {
    const version = my[1]!;
    const isMaria = /mariadb/i.test(output) || /mariadb/i.test(version);
    return `${isMaria ? "MariaDB" : "MySQL"} ${version.replace(/-mariadb.*$/i, "")}`;
  }
  return undefined;
}

/** `0.0.0.0:5433->5432/tcp` → 5433, preferring the mapping that publishes the dialect's port. */
export function publishedPort(ports: string, containerPort: number): number | undefined {
  const mappings = [...ports.matchAll(/(?:[\d.]+|\[[^\]]*\]):(\d+)->(\d+)\/tcp/g)].map((m) => ({
    host: Number(m[1]),
    container: Number(m[2]),
  }));
  const exact = mappings.find((m) => m.container === containerPort);
  return (exact ?? mappings[0])?.host;
}
