// What is installed, whether or not it is running. PATH first, then the per-platform install
// directories.

import path from "node:path";
import type { Dialect } from "@perch/protocol";
import { expandGlob, isExecutableFile, onPath, run } from "./exec.js";
import { parseVersion } from "./parse.js";
import { DEFAULT_PORTS, LOOPBACK, type Sighting } from "./types.js";

/** Server binaries first: `postgres --version` is the server's, `psql --version` the client's. */
const BINARIES: Record<Dialect, string[]> = {
  postgres: ["postgres", "pg_ctl", "psql"],
  mysql: ["mysqld", "mysql"],
};

/** Consulted only when PATH turns up nothing — the usual per-platform install locations. */
function installDirs(dialect: Dialect): string[] {
  if (process.platform === "darwin") {
    return dialect === "postgres"
      ? ["/opt/homebrew/opt/postgresql@*/bin", "/Applications/Postgres.app/Contents/Versions/*/bin"]
      : ["/usr/local/mysql/bin"];
  }
  if (process.platform === "win32") {
    return dialect === "postgres"
      ? ["C:\\Program Files\\PostgreSQL\\*\\bin"]
      : ["C:\\Program Files\\MySQL\\MySQL Server *\\bin"];
  }
  return dialect === "postgres" ? ["/usr/lib/postgresql/*/bin"] : ["/usr/sbin/mysqld", "/usr/sbin"];
}

/** Every candidate path for one dialect's binaries inside the standard install locations. */
async function inInstallDirs(dialect: Dialect): Promise<string[]> {
  const found: string[] = [];
  for (const pattern of installDirs(dialect)) {
    for (const candidate of await expandGlob(pattern)) {
      // The list holds both directories (`.../bin`) and outright binaries (`/usr/sbin/mysqld`).
      if (await isExecutableFile(candidate)) {
        found.push(candidate);
        continue;
      }
      for (const name of BINARIES[dialect]) {
        const exe = path.join(candidate, process.platform === "win32" ? `${name}.exe` : name);
        if (await isExecutableFile(exe)) found.push(exe);
      }
    }
  }
  return found;
}

/**
 * One sighting per dialect whose binaries we can find, carrying the version the binary reports.
 * A binary on its own says nothing about a running server, so it claims `reachable: false` and
 * the default port; the port probe is what upgrades that row.
 */
export async function probeBinaries(): Promise<Sighting[]> {
  const dialects = Object.keys(BINARIES) as Dialect[];
  const sightings = await Promise.all(
    dialects.map(async (dialect) => {
      const paths = (await Promise.all(BINARIES[dialect].map(onPath))).filter(
        (p): p is string => Boolean(p),
      );
      const candidates = paths.length > 0 ? paths : await inInstallDirs(dialect);
      const binary = candidates[0];
      if (!binary) return undefined;
      const sighting: Sighting = {
        dialect,
        host: LOOPBACK,
        port: DEFAULT_PORTS[dialect],
        source: "binary",
        reachable: false,
        label: binary,
      };
      const version = parseVersion(await run(binary, ["--version"]));
      if (version) sighting.version = version;
      return sighting;
    }),
  );
  return sightings.filter((s): s is Sighting => s !== undefined);
}
