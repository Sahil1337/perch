import type { PerchClient } from "@perch/client";
import type {
  HistoryScope,
  HistoryStats,
  RunRecord,
  Settings,
  TransactionEvent,
} from "@perch/protocol";
import type { Run } from "@perch/ui";
import * as React from "react";
import {
  heldSlot,
  heldTransactions,
  latestInSlot,
  type HeldTransaction,
} from "./held-transactions";
import { messageOf } from "./helpers";
import { inScope } from "./run-scope";
import { useAbortable } from "./use-async-resource";

/** In-memory runs. History on disk is the long tail; this is what the History tab scrolls. */
const RUN_CAP = 100;
const HISTORY_LIMIT = 50;

/**
 * Statements after which the schema tree is no longer what the server would introspect. COMMIT
 * too: DDL inside a transaction a tab held open is invisible to the introspection until then.
 */
const DDL = /^(CREATE|ALTER|DROP|TRUNCATE|RENAME|COMMENT|GRANT|REVOKE|REFRESH|COMMIT)\b/i;

const changedSchema = (record: RunRecord): boolean =>
  (record.results ?? []).some((result) => DDL.test(result.command ?? ""));

export type RunsOptions = {
  connectionId: string | null;
  /** Already resolved: the user's pick, or what the connection itself says. See `useConnections`. */
  database: string | null;
  /** The text to run when the caller does not pass any: whatever is in the active buffer. */
  activeSql: string | undefined;
  /** The active buffer's session key, for a run that does not name its tab. */
  activeSessionKey: string | undefined;
  settings: Settings | undefined;
  /** The workspace root the active buffer belongs to; "" for a scratch tab or the CLI. */
  workspace: string;
  /**
   * DDL moves the ground under the schema tree, so it is re-introspected after a run. Resolves
   * once the new schema has landed, which is what `execute` waits for.
   */
  onSchemaChanged: () => Promise<void>;
  openOutput: () => void;
};

export type RunsState = {
  runs: readonly Run[];
  activeRun: Run | undefined;
  activeRunFromHistory: boolean;
  run: (sql?: string, sessionKey?: string) => Promise<string | undefined>;
  execute: (sql: string, options?: { sessionKey?: string }) => Promise<RunRecord>;
  /** Every transaction this session's runs left open, by key, connection and database. */
  held: readonly HeldTransaction[];
  /** Session keys with a run in flight. */
  runningKeys: ReadonlySet<string>;
  /** Connections a key may hold something on: where it holds a transaction, or has a run in flight. */
  connectionsOf: (sessionKey: string) => readonly string[];
  /** The server ended a held transaction without a run; the run that left it open is now closed. */
  transactionClosed: (event: TransactionEvent) => void;
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
  const {
    connectionId,
    database,
    activeSql,
    activeSessionKey,
    settings,
    workspace,
    onSchemaChanged,
    openOutput,
  } = options;

  const [runs, setRuns] = React.useState<readonly Run[]>([]);
  /** Read by `clearHistory`, which decides what to keep after an await — by then `runs` is stale. */
  const runsRef = React.useRef(runs);
  runsRef.current = runs;
  /**
   * Which run the results pane is showing, and how it got there. One value rather than two,
   * because an id and a separate "was this picked from History" flag could disagree, and the
   * only way to notice would be a pane captioning a query you are looking at in the editor.
   */
  const [selected, setSelected] = React.useState<{
    readonly id: string;
    readonly fromHistory: boolean;
  } | null>(null);
  /**
   * Runs the server has already been asked about: `rows` means its result rows were fetched and
   * merged in, `none` means they are gone — it aged out of memory and history was not recording
   * results. Without this a run that legitimately returned no rows would be re-fetched on every
   * click, and a run whose rows are gone would keep a dead export link.
   */
  const [resolved, setResolved] = React.useState<ReadonlyMap<string, "rows" | "none">>(new Map());
  /** Which runs History is showing. Defaults to the folder in front of you, plus the global ones. */
  const [historyScope, setHistoryScope] = React.useState<HistoryScope>("workspace");
  /**
   * Runs `execute` made. They are in `runs` so History shows them, but the results pane never
   * falls back to one: the SQL a view wrote for you is not what you were looking at. A ref, since
   * an id only ever lands together with its run in `runs`, and that update is the re-render. Lost
   * on reload, when the newest run may then be one of these; that is just the latest run.
   */
  const executedIds = React.useRef(new Set<string>());
  /**
   * The session key each of this session's runs carried, and which of those are still waiting for
   * the server's answer. Refs for the same reason as `executedIds`: both only change together with
   * `runs`. A run loaded from History has no entry, so it never claims a tab holds anything.
   */
  const keyOf = React.useRef(new Map<string, string>());
  const inFlight = React.useRef(new Set<string>());
  /** Runs whose transaction the server has since ended: idle, released, disconnected, lost. */
  const [closed, setClosed] = React.useState<ReadonlySet<string>>(new Set());

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
    async (sql?: string, sessionKey?: string): Promise<string | undefined> => {
      const text = (sql ?? activeSql ?? "").trim();
      if (!text || !connectionId) return undefined;
      const key = sessionKey ?? activeSessionKey;

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
        notices: [],
        transaction: null,
        ...(workspace ? { workspace } : {}),
      };
      if (key) {
        keyOf.current.set(runId, key);
        inFlight.current.add(runId);
      }
      setRuns((prev) => [pending, ...prev].slice(0, RUN_CAP));
      setSelected({ id: runId, fromHistory: false });
      openOutput();

      try {
        const record = await getClient().query.runSync({
          connectionId,
          sql: text,
          runId,
          source: "ui",
          ...(database ? { database } : {}),
          ...(workspace ? { workspace } : {}),
          ...(key ? { sessionKey: key } : {}),
          ...(settings ? { maxRows: settings.maxRows } : {}),
          ...(settings ? { timeoutMs: settings.statementTimeoutMs } : {}),
        });
        inFlight.current.delete(runId);
        setRuns((prev) => prev.map((r) => (r.id === runId ? record : r)));
        if (changedSchema(record)) void onSchemaChanged();
      } catch (error) {
        const message = messageOf(error);
        inFlight.current.delete(runId);
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
    [
      activeSessionKey,
      activeSql,
      connectionId,
      database,
      getClient,
      onSchemaChanged,
      openOutput,
      settings,
      workspace,
    ],
  );

  const execute = React.useCallback(
    async (sql: string, executeOptions?: { sessionKey?: string }): Promise<RunRecord> => {
      const text = sql.trim();
      const key = executeOptions?.sessionKey;
      const pending: RunRecord = {
        id: crypto.randomUUID(),
        connectionId: connectionId ?? "",
        database: database ?? "",
        sql: text,
        status: "running",
        startedAt: new Date().toISOString(),
        source: "ui",
        notices: [],
        transaction: null,
      };
      const failed = (message: string): RunRecord => ({
        ...pending,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: { message },
      });
      if (!text) return failed("Nothing to run.");
      if (!connectionId) return failed("No connection selected.");

      // No workspace: the SQL came from a view, not from a file in any folder, so History files it
      // with the global runs.
      executedIds.current.add(pending.id);
      if (key) {
        keyOf.current.set(pending.id, key);
        inFlight.current.add(pending.id);
      }
      setRuns((prev) => [pending, ...prev].slice(0, RUN_CAP));
      let record: RunRecord;
      try {
        record = await getClient().query.runSync({
          connectionId,
          sql: text,
          runId: pending.id,
          source: "ui",
          ...(database ? { database } : {}),
          ...(key ? { sessionKey: key } : {}),
          ...(settings ? { maxRows: settings.maxRows } : {}),
          ...(settings ? { timeoutMs: settings.statementTimeoutMs } : {}),
        });
      } catch (error) {
        record = failed(messageOf(error));
      }
      inFlight.current.delete(pending.id);
      setRuns((prev) => prev.map((r) => (r.id === pending.id ? record : r)));
      if (changedSchema(record)) await onSchemaChanged();
      return record;
    },
    [connectionId, database, getClient, onSchemaChanged, settings],
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
      setSelected({ id: runId, fromHistory: true });
      const held = runs.find((r) => r.id === runId);
      // Any status but `running` is worth asking about. A run that failed or was cancelled on its
      // third statement still has the rows the first two returned, and the server stored them.
      if (!held || held.status === "running" || resolved.has(runId)) return;
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

  /**
   * Clears the store and the list it feeds, so the History tab empties with it. A run still in
   * flight stays: it is not in the store to be cleared, and `run` finishes by mapping over this
   * list — dropped from it, the result it is about to return would have nowhere to land.
   */
  const clearHistory = React.useCallback(async (): Promise<void> => {
    await getClient().history.clear();
    const running = new Set(runsRef.current.filter((r) => r.status === "running").map((r) => r.id));
    setRuns((prev) => prev.filter((r) => r.status === "running"));
    setResolved(new Map());
    setSelected((prev) => (prev && running.has(prev.id) ? prev : null));
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

  // The two refs only ever change together with `runs`, so `runs` is what re-reads them.
  const held = React.useMemo(
    () => heldTransactions(runs, keyOf.current, inFlight.current, closed),
    [runs, closed],
  );

  const runningKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const runId of inFlight.current) {
      const key = keyOf.current.get(runId);
      if (key) keys.add(key);
    }
    return keys;
  }, [runs]);

  const connectionsOf = React.useCallback(
    (sessionKey: string): readonly string[] => {
      const ids = new Set(held.filter((t) => t.sessionKey === sessionKey).map((t) => t.connectionId));
      for (const item of runs) {
        if (inFlight.current.has(item.id) && keyOf.current.get(item.id) === sessionKey) {
          ids.add(item.connectionId);
        }
      }
      return [...ids];
    },
    [held, runs],
  );

  const transactionClosed = React.useCallback((event: TransactionEvent): void => {
    const slot = heldSlot(event.connectionId, event.database, event.sessionKey);
    const latest = latestInSlot(runsRef.current, keyOf.current, inFlight.current, slot);
    if (latest?.transaction) setClosed((prev) => new Set(prev).add(latest.id));
  }, []);

  // The newest run when nothing has been picked, which is what the pane opens on after a reload.
  // That run came off the wire rather than out of this session, so it counts as history: the
  // editor below it is empty or holding something else entirely.
  const selectedRun = selected ? runs.find((r) => r.id === selected.id) : undefined;

  return {
    runs,
    activeRun: selectedRun ?? runs.find((r) => !executedIds.current.has(r.id)),
    activeRunFromHistory: selectedRun ? selected!.fromHistory : true,
    run,
    execute,
    held,
    runningKeys,
    connectionsOf,
    transactionClosed,
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
