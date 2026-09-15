// Local database discovery. perch never bundles Postgres or MySQL — it looks for what is already
// installed or running on this machine and offers to connect to it.
//
// Every probe is best-effort: it runs in parallel under its own short timeout, never throws, and
// contributes whatever it managed to learn. A missing binary, a machine without systemd, a docker
// daemon that is not running — all of those are "found nothing", not errors.

import type { DiscoveryResult } from "@perch/protocol";
import { probeBinaries } from "./binaries.js";
import { probeDocker } from "./docker.js";
import { delay } from "./exec.js";
import { mergeSightings, osUsername } from "./merge.js";
import { probePorts } from "./ports.js";
import { serviceManagerProbes } from "./service-managers.js";
import { DISCOVERY_TTL_MS, SCAN_TIMEOUT_MS, type Sighting } from "./types.js";

export { DISCOVERY_TTL_MS } from "./types.js";

const PROBES = [probePorts, probeBinaries, ...serviceManagerProbes, probeDocker];

/**
 * Runs every probe at once and merges what they saw. Never rejects: a probe that throws or
 * overruns contributes nothing, and the whole scan is capped at `SCAN_TIMEOUT_MS` with whatever
 * landed in time.
 */
export async function discoverServers(): Promise<DiscoveryResult> {
  const started = Date.now();
  const osUser = osUsername();
  const sightings: Sighting[] = [];

  const running = PROBES.map((probe) =>
    probe().then(
      (found) => sightings.push(...found),
      () => undefined,
    ),
  );
  await Promise.race([Promise.all(running), delay(SCAN_TIMEOUT_MS)]);

  return {
    servers: mergeSightings(sightings, osUser),
    osUser,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

/**
 * Discovery with a short memory. Scanning shells out half a dozen times, so the result is held for
 * `ttlMs` and concurrent callers share one in-flight scan — the UI can poll this freely, and
 * `?rescan=1` is what forces real work.
 */
export class DiscoveryService {
  readonly ttlMs: number;
  private cached?: { at: number; result: DiscoveryResult };
  private inflight?: Promise<DiscoveryResult>;

  constructor(ttlMs: number = DISCOVERY_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  async scan(opts: { force?: boolean } = {}): Promise<DiscoveryResult> {
    if (!opts.force && this.cached && Date.now() - this.cached.at < this.ttlMs) {
      return this.cached.result;
    }
    if (!this.inflight) {
      this.inflight = discoverServers()
        .then((result) => {
          this.cached = { at: Date.now(), result };
          return result;
        })
        .finally(() => {
          this.inflight = undefined;
        });
    }
    return this.inflight;
  }

  /** Drops the memo, so the next `scan()` probes again. */
  clear(): void {
    this.cached = undefined;
  }
}
