import type { PerchClient } from "@perch/client";
import type { HistoryScope, HistoryStats, RunRecord, Settings } from "@perch/protocol";
import type { Run } from "@perch/ui";
import * as React from "react";
import { messageOf } from "./helpers";
import { inScope } from "./run-scope";
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
  /** The workspace root the active buffer belongs to; "" for a scratch tab or the CLI. */
  workspace: string;
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
  historyStats: () => Promise<HistoryStats>;
  clearHistory: () => Promise<void>;
  historyScope: HistoryScope;
  setHistoryScope: (scope: HistoryScope) => void;
};

export function useRuns(
  getClient: () => PerchClient,
  enabled: boolean,
  options: RunsOptions,
): RunsState {
  const { connectionId, database, activeSql, settings, workspace, onSchemaChanged, openOutput } =
    options;

  const [runs, setRuns] = React.useState<readonly Run[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  /**
   * Runs the server has already been asked about: `rows` means its result rows were fetched and
   * merged in, `none` means they are gone — it aged out of memory and history was not recording
   * results. Without this a run that legitimately returned no rows would be re-fetched on every
   * click, and a run whose rows are gone would keep a dead export link.
   */
  const [resolved, setResolved] = React.useState<ReadonlyMap<string, "rows" | "none">>(new Map());
  /** Which runs History is showing. Defaults to the folder in front of you, plus the global ones. */
  const [historyScope, setHistoryScope] = React.useState<HistoryScope>("workspace");

  const loadHistory = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      try {
        const history = await getClient().history.list({
          limit: HISTORY_LIMIT,
          scope: historyScope,
          workspace,
          signal,
        });
        // Headers only. Rows are fetched per run, when one is selected: a page of fifty runs with
        // their rows would be megabytes to render three lines of SQL each.
        //
        // Merged rather than replaced, and this session's runs are filtered by the same rule the
        // server used: with history recording off nothing comes back from disk, and replacing
        // would wipe the runs you can still see from this session.
        setRuns((prev) => {
          const live = prev.filter((item) => inScope(item, historyScope, workspace));
          const seen = new Set(live.map((item) => item.id));
          const merged = [...live, ...history.filter((item) => !seen.has(item.id))];
          merged.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
          return merged.slice(0, RUN_CAP);
        });
      } catch {
        /* history is a nicety; an empty list is a fine outcome */
      }
    },
    [getClient, historyScope, workspace],
  );

  // Re-reads when the scope or the folder changes, which is what makes the picker work: the list
  // is a page from the server, not a filter over one already fetched.
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
        ...(workspace ? { workspace } : {}),
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
          ...(workspace ? { workspace } : {}),
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
    [activeSql, connectionId, database, getClient, onSchemaChanged, openOutput, settings, workspace],
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

  /**
   * Points at a run and, if its rows are not already here, asks the server for them.
   *
   * The history list is headers, and the last fifty runs are the only ones the server holds in
   * memory — so before this, clicking anything older showed a results pane that claimed a row count
   * and had nothing in it. The server now answers from the history store too, when the settings
   * were recording results, and a 404 is the honest "those rows were not kept".
   */
  const selectRun = React.useCallback(
    (runId: string): void => {
      setSelectedRunId(runId);
      const held = runs.find((r) => r.id === runId);
      if (!held || held.status !== "done" || resolved.has(runId)) return;
      if ((held.results ?? []).some((result) => result.rows.length > 0)) return;

      void getClient()
        .runs.get(runId)
        .then(
          (full) => {
            setRuns((prev) => prev.map((r) => (r.id === runId ? full : r)));
            setResolved((prev) => new Map(prev).set(runId, "rows"));
          },
          () => setResolved((prev) => new Map(prev).set(runId, "none")),
        );
    },
    [getClient, resolved, runs],
  );

  const exportUrl = React.useCallback(
    (
      runId: string,
      exportOptions?: { statement?: number; format?: "csv" | "json" },
    ): string | null => {
      const held = runs.find((r) => r.id === runId);
      if (!held || held.status !== "done") return null;
      // The one case with nothing to download: the run aged out of server memory and history was
      // not recording results, so the link would 404.
      if (resolved.get(runId) === "none") return null;
      return getClient().runs.exportUrl(runId, exportOptions);
    },
    [getClient, resolved, runs],
  );

  const historyStats = React.useCallback(
    (): Promise<HistoryStats> => getClient().history.stats(),
    [getClient],
  );

  /** Clears the store and the list it feeds, so the History tab empties with it. */
  const clearHistory = React.useCallback(async (): Promise<void> => {
    await getClient().history.clear();
    setRuns([]);
    setResolved(new Map());
    setSelectedRunId(null);
  }, [getClient]);

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
    selectRun,
    probe,
    historyStats,
    clearHistory,
    historyScope,
    setHistoryScope,
  };
}
