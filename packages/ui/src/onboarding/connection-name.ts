import type { ConnectionSummary, DiscoveredServer } from "@perch/protocol";
import { DIALECT_DEFAULTS } from "./dialect-mark";

/**
 * A name for a discovered server that nothing on disk is already using.
 *
 * The old scheme was `<dialect>-local` for every row, and it collided with itself in both of the
 * ways that matter: a machine running two Postgres servers could only ever save the first, and a
 * first attempt that failed saved the record its own retry then tripped over. The server answers a
 * duplicate name with a 409, which the screen reported as "that connection did not answer" — the
 * one thing that had not happened.
 */
export function suggestedName(
  server: DiscoveredServer,
  taken: readonly ConnectionSummary[],
): string {
  // A container's name is the one the user chose in their compose file; nothing this side invents
  // will beat it.
  const container = server.sources.includes("docker") ? server.label : undefined;
  const base =
    container ??
    (server.port === DIALECT_DEFAULTS[server.dialect].port
      ? `${server.dialect}-local`
      : `${server.dialect}-${server.port}`);

  const names = new Set(taken.map((item) => item.name));
  if (!names.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}
