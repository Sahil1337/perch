import type { HistoryScope, HistoryStats, RunRecord } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

export type HistoryOptions = CallOptions & {
  /** Clamped server-side to 1..1000; default 50. */
  limit?: number;
  connectionId?: string;
  /** Default "all". `workspace` needs `workspace` set, and includes runs belonging to no folder. */
  scope?: HistoryScope;
  workspace?: string;
};

export type HistoryApi = {
  /**
   * Past runs read back from disk, so they survive a server restart. Headers only: a run's rows,
   * when the settings kept them, come from `runs.get`.
   */
  list(opts?: HistoryOptions): Promise<RunRecord[]>;
  /** What the store is costing, for the pane that offers to clear it. */
  stats(opts?: CallOptions): Promise<HistoryStats>;
  /** Drops every recorded run and its rows. Not undoable. */
  clear(opts?: CallOptions): Promise<void>;
};

export function historyApi(http: Transport): HistoryApi {
  return {
    list: (opts) =>
      http.json<RunRecord[]>("/api/history", {
        query: {
          limit: opts?.limit,
          connectionId: opts?.connectionId,
          scope: opts?.scope,
          workspace: opts?.workspace,
        },
        signal: opts?.signal,
      }),
    stats: (opts) => http.json<HistoryStats>("/api/history/stats", { signal: opts?.signal }),
    clear: async (opts) => {
      await http.json<{ ok: boolean }>("/api/history", {
        method: "DELETE",
        signal: opts?.signal,
      });
    },
  };
}
