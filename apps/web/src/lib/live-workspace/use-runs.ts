import type { PerchClient } from "@perch/client";
import type { RunRecord, Settings } from "@perch/protocol";
import type { Run } from "@perch/ui";
import * as React from "react";
import { messageOf } from "./helpers";
import { useAbortable } from "./use-async-resource";

/** In-memory runs. History on disk is the long tail; this is what the History tab scrolls. */
const RUN_CAP = 100;
const HISTORY_LIMIT = 50;

/** Statements after which the schema tree is no longer what the server would introspect. */
const DDL = /^(CREATE|ALTER|DROP|TRUNCATE|RENAME|COMMENT|GRANT|REVOKE|REFRESH)\b/i;

export type RunsOptions = {
  connectionId: string | null;
  /** Already resolved: the user's pick, or what the connection itself says. See `useConnections`. */
  database: string | null;
  /** The text to run when the caller does not pass any: whatever is in the active buffer. */
  activeSql: string | undefined;
  settings: Settings | undefined;
  /** DDL moves the ground under the schema tree, so it is re-introspected after a run. */
  onSchemaChanged: () => void;
  openOutput: () => void;
};

export type RunsState = {
  runs: readonly Run[];
  activeRun: Run | undefined;
  run: (sql?: string) => Promise<string | undefined>;
  exportUrl: (
    runId: string,
    options?: { statement?: number; format?: "csv" | "json" },
  ) => string | null;
  cancelRun: (runId: string) => Promise<void>;
  selectRun: (runId: string) => void;
  probe: (sql: string, options?: { maxRows?: number }) => Promise<RunRecord>;
};

export function useRuns(
  getClient: () => PerchClient,
  enabled: boolean,
  options: RunsOptions,
): RunsState {
  const { connectionId, database, activeSql, settings, onSchemaChanged, openOutput } = options;

  const [runs, setRuns] = React.useState<readonly Run[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);

  const loadHistory = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      try {
        const history = await getClient().history.list({ limit: HISTORY_LIMIT, signal });
        // Rows are not kept on disk, so these records are headers only.
        setRuns((prev) => (prev.length > 0 ? prev : history.slice(0, RUN_CAP)));
      } catch {
        /* history is a nicety; an empty list is a fine outcome */
      }
    },
    [getClient],
  );

  useAbortable(enabled, loadHistory);

  const run = React.useCallback(
    async (sql?: string): Promise<string | undefined> => {
      const text = (sql ?? activeSql ?? "").trim();
      if (!text || !connectionId) return undefined;

      // The client owns the id: cancel needs an address before the run is over.
      const runId = crypto.randomUUID();
      const pending: RunRecord = {
        id: runId,
        connectionId,
        database: database ?? "",
        sql: text,
        status: "running",
        startedAt: new Date().toISOString(),
        source: "ui",
      };
      setRuns((prev) => [pending, ...prev].slice(0, RUN_CAP));
      setSelectedRunId(runId);
      openOutput();

      try {
        const record = await getClient().query.runSync({
          connectionId,
          sql: text,
          runId,
          source: "ui",
          ...(database ? { database } : {}),
          ...(settings ? { maxRows: settings.maxRows } : {}),
          ...(settings ? { timeoutMs: settings.statementTimeoutMs } : {}),
        });
        setRuns((prev) => prev.map((r) => (r.id === runId ? record : r)));
        if ((record.results ?? []).some((result) => DDL.test(result.command ?? ""))) {
          onSchemaChanged();
        }
      } catch (error) {
        const message = messageOf(error);
        setRuns((prev) =>
          prev.map((r) =>
            r.id === runId
              ? { ...r, status: "error", finishedAt: new Date().toISOString(), error: { message } }
              : r,
          ),
        );
      }
      return runId;
    },
    [activeSql, connectionId, database, getClient, onSchemaChanged, openOutput, settings],
  );

  /**
   * A run that leaves no trace: not in `runs`, not in History, and read-only on the server. The
   * query walk's step queries go through here. Rejects only when there is nothing to run against.
   */
  const probe = React.useCallback(
    (sql: string, probeOptions?: { maxRows?: number }): Promise<RunRecord> => {
      const text = sql.trim();
      if (!text) return Promise.reject(new Error("Nothing to run."));
      if (!connectionId) return Promise.reject(new Error("No connection selected."));
      return getClient().query.runSync({
        connectionId,
        sql: text,
        runId: crypto.randomUUID(),
        source: "ui",
        record: false,
        readOnly: true,
        ...(database ? { database } : {}),
        ...(probeOptions?.maxRows !== undefined
          ? { maxRows: probeOptions.maxRows }
          : settings
            ? { maxRows: settings.maxRows }
            : {}),
        ...(settings ? { timeoutMs: settings.statementTimeoutMs } : {}),
      });
    },
    [connectionId, database, getClient, settings],
  );

  const exportUrl = React.useCallback(
    (
      runId: string,
      exportOptions?: { statement?: number; format?: "csv" | "json" },
    ): string | null => {
      // Runs age out of server memory, so a link is only offered while the rows are still held.
      const held = runs.find((r) => r.id === runId);
      if (!held || held.status !== "done") return null;
      return getClient().runs.exportUrl(runId, exportOptions);
    },
    [getClient, runs],
  );

  const cancelRun = React.useCallback(
    async (runId: string): Promise<void> => {
      try {
        await getClient().runs.cancel(runId);
      } catch {
        /* already finished, or aged out — the local state below is still the right answer */
      }
      setRuns((prev) =>
        prev.map((r) =>
          r.id === runId && r.status === "running"
            ? { ...r, status: "cancelled", finishedAt: new Date().toISOString() }
            : r,
        ),
      );
    },
    [getClient],
  );

  return {
    runs,
    activeRun: runs.find((r) => r.id === selectedRunId) ?? runs[0],
    run,
    exportUrl,
    cancelRun,
    selectRun: setSelectedRunId,
    probe,
  };
}
