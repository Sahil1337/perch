// Many probes, one row per server: sightings are keyed by dialect+host+port, so the psql on PATH
// and the socket answering on 5432 become one entry carrying both sources.

import os from "node:os";
import type { Dialect, DiscoveredServer } from "@perch/protocol";
import type { Sighting } from "./types.js";

export function osUsername(): string {
  try {
    return os.userInfo().username || "postgres";
  } catch {
    return "postgres";
  }
}

function suggestedUrl(dialect: Dialect, host: string, port: number, osUser: string): string {
  // MySQL's superuser is `root` everywhere; Postgres conventionally matches the OS account.
  return dialect === "mysql"
    ? `mysql://root@${host}:${port}/`
    : `postgres://${osUser}@${host}:${port}/postgres`;
}

/** Reachable first, Postgres before MySQL, then by port — the order the UI offers them in. */
function compareServers(a: DiscoveredServer, b: DiscoveredServer): number {
  if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
  if (a.dialect !== b.dialect) return a.dialect === "postgres" ? -1 : 1;
  return a.port - b.port;
}

export function mergeSightings(sightings: Sighting[], osUser: string): DiscoveredServer[] {
  const byKey = new Map<string, DiscoveredServer>();
  for (const s of sightings) {
    const key = `${s.dialect}|${s.host}|${s.port}`;
    const existing = byKey.get(key);
    if (!existing) {
      const server: DiscoveredServer = {
        dialect: s.dialect,
        host: s.host,
        port: s.port,
        sources: [s.source],
        reachable: s.reachable ?? false,
        suggestedUrl: suggestedUrl(s.dialect, s.host, s.port, osUser),
      };
      if (s.version) server.version = s.version;
      if (s.label) server.label = s.label;
      byKey.set(key, server);
      continue;
    }
    if (!existing.sources.includes(s.source)) existing.sources.push(s.source);
    existing.reachable = existing.reachable || (s.reachable ?? false);
    if (!existing.version && s.version) existing.version = s.version;
    if (!existing.label && s.label) existing.label = s.label;
  }
  return [...byKey.values()].sort(compareServers);
}
