import type { RunRecord } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

export type HistoryOptions = CallOptions & {
  /** Clamped server-side to 1..1000; default 50. */
  limit?: number;
  connectionId?: string;
};

export type HistoryApi = {
  /** Past runs read back from disk, so they survive a server restart. Never carries rows. */
  list(opts?: HistoryOptions): Promise<RunRecord[]>;
};

export function historyApi(http: Transport): HistoryApi {
  return {
    list: (opts) =>
      http.json<RunRecord[]>("/api/history", {
        query: { limit: opts?.limit, connectionId: opts?.connectionId },
        signal: opts?.signal,
      }),
  };
}
