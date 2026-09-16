import type { BrowseResult } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

export type BrowseOptions = CallOptions & {
  /** Absolute path to list. Omitted means the user's home directory. */
  path?: string;
};

/**
 * Folders on the machine running the server, for the workspace picker. One route, so one callable
 * — the same shape as `discover`.
 */
export type BrowseApi = (opts?: BrowseOptions) => Promise<BrowseResult>;

export function browseApi(http: Transport): BrowseApi {
  return function browse(opts: BrowseOptions = {}): Promise<BrowseResult> {
    return http.json<BrowseResult>("/api/browse", {
      query: { path: opts.path },
      signal: opts.signal,
    });
  };
}
