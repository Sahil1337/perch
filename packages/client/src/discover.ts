import type { DiscoveryResult } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

export type DiscoverOptions = CallOptions & {
  /** Bypasses the server's 30s memo and probes the machine again. */
  rescan?: boolean;
};

/**
 * The database servers already on the user's machine. A single callable rather than an object
 * of routes, because there is only the one route — same shape as `events`.
 */
export type DiscoverApi = (opts?: DiscoverOptions) => Promise<DiscoveryResult>;

export function discoverApi(http: Transport): DiscoverApi {
  return function discover(opts: DiscoverOptions = {}): Promise<DiscoveryResult> {
    return http.json<DiscoveryResult>("/api/discover", {
      query: { rescan: opts.rescan ? "1" : undefined },
      signal: opts.signal,
    });
  };
}
