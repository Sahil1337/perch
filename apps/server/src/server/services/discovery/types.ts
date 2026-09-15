import type { Dialect, DiscoverySource } from "@perch/protocol";

/** Per-probe budget. Nothing here is allowed to make the UI wait. */
export const PROBE_TIMEOUT_MS = 800;
/** Whole-scan budget: whatever has landed by then is the answer. */
export const SCAN_TIMEOUT_MS = 2_000;
/** How long a scan is reused before the next one actually re-probes. */
export const DISCOVERY_TTL_MS = 30_000;

/**
 * Kept here rather than imported from `db/url.ts` so discovery stays free of the driver layer:
 * this module is loaded by `perch discover`, which has no reason to pull in pg and mysql2.
 */
export const DEFAULT_PORTS: Record<Dialect, number> = { postgres: 5432, mysql: 3306 };
export const LOOPBACK = "127.0.0.1";

/** One probe's raw sighting, before sightings of the same server are merged. */
export type Sighting = {
  dialect: Dialect;
  host: string;
  port: number;
  source: DiscoverySource;
  version?: string;
  reachable?: boolean;
  label?: string;
};
