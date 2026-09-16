import type { RunRecord } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

export type ExportOptions = {
  /** Default "csv". */
  format?: "csv" | "json";
  /** Which statement of a multi-statement run to export. Default 0. */
  statement?: number;
};

export type RunsApi = {
  list(opts?: CallOptions): Promise<RunRecord[]>;
  get(id: string, opts?: CallOptions): Promise<RunRecord>;
  cancel(id: string, opts?: CallOptions): Promise<boolean>;
  exportUrl(id: string, options?: ExportOptions): string;
};

export function runsApi(http: Transport): RunsApi {
  return {
    // Newest first, and without result rows — the rows come from get().
    list: (opts) => http.json<RunRecord[]>("/api/runs", { signal: opts?.signal }),

    get: (id, opts) =>
      http.json<RunRecord>(`/api/runs/${encodeURIComponent(id)}`, { signal: opts?.signal }),

    cancel: async (id, opts) =>
      (
        await http.json<{ cancelled: boolean }>(`/api/runs/${encodeURIComponent(id)}/cancel`, {
          method: "POST",
          signal: opts?.signal,
        })
      ).cancelled,

    /**
     * A URL, not a fetch: the download has to be a browser navigation (`<a download>` or
     * `location.href`) for the file to land in the downloads folder with the server's filename.
     */
    exportUrl: (id, options) =>
      http.url(`/api/runs/${encodeURIComponent(id)}/export`, {
        format: options?.format ?? "csv",
        statement: options?.statement,
      }),
  };
}
