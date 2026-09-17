import type { ConnectionSummary, Dialect, DiscoveredServer } from "@perch/protocol";

/**
 * Which dialect the screen is about. Reachable beats merely present — an installed but idle
 * Postgres is a worse answer than a MySQL accepting connections — and Postgres breaks a tie.
 */
export function preferDialect(
  found: readonly DiscoveredServer[] | null,
  saved: readonly ConnectionSummary[],
): Dialect | null {
  const tiers: readonly (readonly { dialect: Dialect }[])[] = [
    found?.filter((server) => server.reachable) ?? [],
    found ?? [],
    saved,
  ];

  for (const tier of tiers) {
    if (tier.some((item) => item.dialect === "postgres")) return "postgres";
    const other = tier[0]?.dialect;
    if (other !== undefined) return other;
  }
  return null;
}
