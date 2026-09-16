"use client";

// The implementation of WorkspaceApi, backed by `perch serve` through @perch/client. There is no
// fixture provider and no offline mode, so everything any surface renders came off the wire.
// Derived-not-stored is the rule throughout: schema staleness is computed from what loaded versus
// what is wanted, never written into state by an effect.
//
// Actions report failures through state rather than rejecting. The exceptions are the ones whose
// return value *is* the answer and so have no state channel to fail into: `testConnection`,
// `addConnection`/`updateConnection`, and `discoverServers`.
//
// Above all of it sits the server gate: whether the server answers at all. `GET /api/health`
// decides between `ready` and `unreachable`, re-probing on a 1s→10s backoff so a server started a
// minute later is picked up without a reload. Nothing else is requested until it is `ready`, so
// eleven panels cannot each render their own copy of the same failure.

import {
  asyncData,
  asyncError,
  asyncIdle,
  asyncLoading,
  asyncReady,
  asyncRefreshing,
  type Async,
  type Buffer,
  type ConnectionInput,
  type ConnectionTest,
  type CursorPosition,
  type Run,
  type SaveState,
  type ServerState,
  type ServerStatus,
  type WorkspaceApi,
} from "@perch/ui";
import { isPerchError, staleWrite, type FilesApi, type PerchClient } from "@perch/client";
import type {
  ConnectionSummary,
  DatabaseSchema,
  DiscoveryResult,
  FileEntry,
  RunRecord,
  ServerEvent,
  Settings,
} from "@perch/protocol";
import * as React from "react";
import { serverBaseUrl, serverClient } from "./server-client";
import { usePanels } from "./use-panels";

/** In-memory runs. History on disk is the long tail; this is what the History tab scrolls. */
const RUN_CAP = 100;
const HISTORY_LIMIT = 50;

/** Directories the workspace walk will list before it stops. A guard, not a policy. */
const MAX_DIRS = 64;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

/** Statements after which the schema tree is no longer what the server would introspect. */
const DDL = /^(CREATE|ALTER|DROP|TRUNCATE|RENAME|COMMENT|GRANT|REVOKE|REFRESH)\b/i;

/** Server paths are native, so a Windows server sends backslashes. Split on both. */
const SEPARATORS = /[\\/]/;

function fileName(path: string): string {
  const parts = path.split(SEPARATORS);
  return parts[parts.length - 1] ?? path;
}

function dirName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? path : path.slice(0, cut);
}

/** Keyed by path so `openFile` on an already-open file is a focus, not a second tab. */
function bufferIdFor(path: string): string {
  return `file:${path}`;
}

function fileBuffer(path: string, content: string): Buffer {
  return {
    id: bufferIdFor(path),
    path,
    name: fileName(path),
    content,
    dirty: false,
    view: "script",
  };
}

function withoutConflict({ conflict: _resolved, ...rest }: Buffer): Buffer {
  return rest;
}

function messageOf(error: unknown): string {
  if (isPerchError(error)) return error.message;
  return error instanceof Error ? error.message : "the request failed";
}

function aborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Replaces a summary in place, keeping the server's order for anything it did not touch. */
function upsertSummary(
  list: readonly ConnectionSummary[],
  summary: ConnectionSummary,
): readonly ConnectionSummary[] {
  return list.some((c) => c.id === summary.id)
    ? list.map((c) => (c.id === summary.id ? summary : c))
    : [...list, summary];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Every `.sql` file under the workspace roots, breadth-first, plus the roots as their own entries
 * spell them.
 *
 * `GET /api/files` lists one directory, so a tree costs a request per directory — hence the cap.
 * The flat result is the shape `FilesList` wants. The roots need re-spelling because the server
 * resolves symlinks when reading a path but not when reporting a root, so a root configured as
 * `/tmp/ws` reports as `/tmp/ws` while its files come back under `/private/tmp/ws`; grouping by the
 * reported spelling would file every entry under a second, synthesised heading.
 */
async function walkWorkspace(
  files: FilesApi,
  reported: readonly string[],
  signal: AbortSignal,
): Promise<{ entries: FileEntry[]; roots: string[] }> {
  // One unreadable directory is not a failed workspace.
  const list = (dir: string): Promise<FileEntry[]> =>
    files.list(dir, { signal }).catch((): FileEntry[] => []);

  const top = await Promise.all(reported.map(list));
  const roots = reported.map((root, index) => {
    const child = top[index]?.[0];
    return child ? dirName(child.path) : root;
  });

  const entries = top.flat();
  let level = entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path);
  let listed = reported.length;
  while (level.length > 0 && listed < MAX_DIRS) {
    const batch = level.slice(0, MAX_DIRS - listed);
    listed += batch.length;
    const found = (await Promise.all(batch.map(list))).flat();
    entries.push(...found);
    level = found.filter((entry) => entry.kind === "dir").map((entry) => entry.path);
  }
  return { entries, roots };
}

export type LiveWorkspaceOptions = {
  /** Injected by tests; the shared singleton otherwise. */
  client?: PerchClient;
};

export function useLiveWorkspace(options: LiveWorkspaceOptions = {}): WorkspaceApi {
  const { client: injected } = options;
  // Built on first use: it reads `window.location.origin`, absent when the export is prerendered.
  const getClient = React.useCallback((): PerchClient => injected ?? serverClient(), [injected]);

  /* --------------------------------------------------------------- the server */

  const [serverStatus, setServerStatus] = React.useState<ServerStatus>("connecting");
  /** From the health reply: perch's own queries folder, for "save this untitled query". */
  const [queriesDir, setQueriesDir] = React.useState<string | null>(null);
  /** Bumped by `retry()` to restart the probe loop from its shortest delay. */
  const [probeNonce, setProbeNonce] = React.useState(0);

  // `probing`, not `serverStatus`, or settling to `unreachable` restarts the loop and resets the
  // backoff to zero on every failure — a hot spin against a port nobody is listening on.
  const probing = serverStatus === "connecting" || serverStatus === "unreachable";
  React.useEffect(() => {
    if (!probing) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let delay = RECONNECT_MIN_MS;
      while (!signal.aborted) {
        try {
          const info = await getClient().health({ signal });
          if (!signal.aborted) {
            setQueriesDir(info.queriesDir ?? null);
            setServerStatus("ready");
          }
          return;
        } catch (error) {
          if (signal.aborted || aborted(error)) return;
          setServerStatus("unreachable");
        }
        await sleep(delay, signal);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      }
    })();
    return () => controller.abort();
  }, [probing, probeNonce, getClient]);

  /** Every load and effect below is gated on this, so a gated app makes exactly one request. */
  const enabled = serverStatus === "ready";

  const [connections, setConnections] =
    React.useState<Async<readonly ConnectionSummary[]>>(asyncLoading);
  const [connectionId, setConnectionId] = React.useState<string | null>(null);
  const [database, setDatabase] = React.useState<string | null>(null);
  const [fetchedDatabases, setFetchedDatabases] = React.useState<{
    connectionId: string;
    value: Async<readonly string[]>;
  } | null>(null);

  const [settings, setSettings] = React.useState<Async<Settings>>(asyncLoading);
  const [workspace, setWorkspace] = React.useState<Async<readonly FileEntry[]>>(asyncLoading);
  const [serverRoots, setServerRoots] = React.useState<readonly string[]>([]);

  const [buffers, setBuffers] = React.useState<readonly Buffer[]>([]);
  const [activeBufferId, setActiveBufferId] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [cursor, setCursor] = React.useState<CursorPosition>({ line: 1, col: 1 });

  const [runs, setRuns] = React.useState<readonly Run[]>([]);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);

  const { panels, setPanel, togglePanel } = usePanels();

  const scratchCount = React.useRef(0);
  /** What each file buffer was read at, for `ifModifiedAt`. Bookkeeping, not renderable state. */
  const readAt = React.useRef(new Map<string, string>());
  /** Bumped on every edit, so a save that finishes after a keystroke does not claim "saved". */
  const editSeq = React.useRef(0);

  /* ------------------------------------------------------------------ loads */

  const loadConnections = React.useCallback(
    async (signal: AbortSignal): Promise<readonly ConnectionSummary[] | undefined> => {
      setConnections((prev) => asyncRefreshing(prev));
      try {
        const list = await getClient().connections.list({ signal });
        setConnections(asyncReady(list));
        return list;
      } catch (error) {
        if (!aborted(error)) setConnections((prev) => asyncError(messageOf(error), prev));
        return undefined;
      }
    },
    [getClient],
  );

  const loadSettings = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      setSettings((prev) => asyncRefreshing(prev));
      try {
        setSettings(asyncReady(await getClient().settings.get({ signal })));
      } catch (error) {
        if (!aborted(error)) setSettings((prev) => asyncError(messageOf(error), prev));
      }
    },
    [getClient],
  );

  const loadWorkspace = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      setWorkspace((prev) => asyncRefreshing(prev));
      try {
        const files = getClient().files;
        // With no `dir` the server hands back the roots themselves, which is the authority:
        // `perch serve --dir` adds roots that Settings.workspaces never sees.
        const reported = await files.list(undefined, { signal });
        const walked = await walkWorkspace(files, reported.map((entry) => entry.path), signal);
        setServerRoots(walked.roots);
        setWorkspace(asyncReady(walked.entries));
      } catch (error) {
        if (!aborted(error)) setWorkspace((prev) => asyncError(messageOf(error), prev));
      }
    },
    [getClient],
  );

  /** Fire-and-forget refreshes from callbacks and events, where there is no effect to cancel. */
  const refresh = React.useCallback(
    (what: "connections" | "settings" | "workspace"): void => {
      const signal = new AbortController().signal;
      if (what === "connections") void loadConnections(signal);
      if (what === "settings") void loadSettings(signal);
      if (what === "workspace") void loadWorkspace(signal);
    },
    [loadConnections, loadSettings, loadWorkspace],
  );

  /* ------------------------------------------------------------------ boot */

  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;

    void (async () => {
      const list = await loadConnections(signal);
      if (signal.aborted || !list) return;
      // Prefer one the server already has open: it is the one the CLI or a previous session used.
      const first = list.find((c) => c.status === "connected") ?? list[0];
      if (!first) return;
      setConnectionId(first.id);
      setDatabase(first.database);
      // Loading the schema would connect the driver anyway, but only an explicit connect
      // refreshes the summary, so the topbar dot would stay grey over a loaded tree.
      if (first.status !== "connected") {
        try {
          const summary = await getClient().connections.connect(first.id, { signal });
          if (!signal.aborted) {
            setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
          }
        } catch {
          /* the picker shows the failure state from the next connections load */
        }
      }
    })();
    void loadSettings(signal);
    void loadWorkspace(signal);
    void (async () => {
      try {
        const history = await getClient().history.list({ limit: HISTORY_LIMIT, signal });
        // Rows are not kept on disk, so these records are headers only.
        setRuns((prev) => (prev.length > 0 ? prev : history.slice(0, RUN_CAP)));
      } catch {
        /* history is a nicety; an empty list is a fine outcome */
      }
    })();

    return () => controller.abort();
  }, [enabled, getClient, loadConnections, loadSettings, loadWorkspace]);

  /* ----------------------------------------------------------- connections */

  const connection = React.useMemo(
    () => asyncData(connections)?.find((c) => c.id === connectionId),
    [connections, connectionId],
  );

  const summaryDatabases = connection?.databases;

  React.useEffect(() => {
    if (!enabled || !connectionId || summaryDatabases) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const list = await getClient().connections.databases(connectionId, {
          signal: controller.signal,
        });
        setFetchedDatabases({ connectionId, value: asyncReady(list) });
      } catch (error) {
        if (aborted(error)) return;
        setFetchedDatabases({ connectionId, value: asyncError(messageOf(error)) });
      }
    })();
    return () => controller.abort();
  }, [enabled, connectionId, summaryDatabases, getClient]);

  const databases = React.useMemo<Async<readonly string[]>>(() => {
    if (!connectionId) return asyncIdle;
    if (summaryDatabases) return asyncReady(summaryDatabases);
    if (fetchedDatabases?.connectionId === connectionId) return fetchedDatabases.value;
    return asyncLoading;
  }, [connectionId, summaryDatabases, fetchedDatabases]);

  /* --------------------------------------------------------------- schema */

  // Staleness is a comparison, not a stored flag. A different database gets a skeleton, because
  // another database's tables would be a lie; the same one refetching stays up and reads stale.
  const schemaKey = connectionId && database ? `${connectionId}/${database}` : null;
  const [schemaNonce, setSchemaNonce] = React.useState(0);
  const [loadedSchema, setLoadedSchema] = React.useState<{
    key: string;
    nonce: number;
    value: Async<DatabaseSchema>;
  } | null>(null);
  /** What the in-flight (or last) fetch was for, so a nonce bump can ask for `refresh=1`. */
  const schemaFetch = React.useRef<{ key: string; nonce: number } | null>(null);

  React.useEffect(() => {
    if (!enabled || !schemaKey || !connectionId || !database) return;
    const previous = schemaFetch.current;
    // Only a bump on the same connection/database is a "refresh"; a new key has nothing cached.
    const refreshCache = previous?.key === schemaKey && previous.nonce !== schemaNonce;
    schemaFetch.current = { key: schemaKey, nonce: schemaNonce };

    const controller = new AbortController();
    void (async () => {
      try {
        const value = await getClient().connections.schema(connectionId, {
          database,
          refresh: refreshCache,
          signal: controller.signal,
        });
        setLoadedSchema({ key: schemaKey, nonce: schemaNonce, value: asyncReady(value) });
      } catch (error) {
        if (aborted(error)) return;
        setLoadedSchema((prev) => ({
          key: schemaKey,
          nonce: schemaNonce,
          value: asyncError(messageOf(error), prev?.key === schemaKey ? prev.value : undefined),
        }));
      }
    })();
    return () => controller.abort();
  }, [enabled, schemaKey, connectionId, database, schemaNonce, getClient]);

  const schema = React.useMemo<Async<DatabaseSchema>>(() => {
    if (!schemaKey) return asyncIdle;
    if (!loadedSchema || loadedSchema.key !== schemaKey) return asyncLoading;
    if (loadedSchema.nonce !== schemaNonce) return asyncRefreshing(loadedSchema.value);
    return loadedSchema.value;
  }, [schemaKey, loadedSchema, schemaNonce]);

  /* --------------------------------------------------------------- saving */

  const settingsData = asyncData(settings);
  const autosave = settingsData?.autosave ?? true;
  const autosaveDelayMs = settingsData?.autosaveDelayMs ?? 1200;
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);

  /**
   * Writes every dirty file buffer, not just the active one: the save indicator and autosave are
   * both global, so leaving a background tab unwritten while the chrome says "saved" would be a lie.
   */
  const commitSave = React.useCallback(async (): Promise<void> => {
    const dirty = buffers.filter((b) => b.path !== null && b.dirty);
    if (dirty.length === 0) {
      setSaveState((prev) => (prev === "error" ? prev : "saved"));
      return;
    }
    const seq = editSeq.current;
    setSaveState("saving");
    let failed = false;

    await Promise.all(
      dirty.map(async (buffer) => {
        const path = buffer.path;
        if (path === null) return;
        const ifModifiedAt = readAt.current.get(buffer.id);
        try {
          const written = await getClient().files.write({
            path,
            content: buffer.content,
            ...(ifModifiedAt ? { ifModifiedAt } : {}),
          });
          readAt.current.set(buffer.id, written.modifiedAt);
          setBuffers((prev) =>
            prev.map((b) =>
              b.id === buffer.id
                // Keystrokes that landed during the write stay dirty, for the next save.
                ? withoutConflict({ ...b, dirty: b.content !== buffer.content })
                : b,
            ),
          );
        } catch (error) {
          failed = true;
          const stale = staleWrite(error);
          if (!stale) return;
          // The 409 carries the file as it is on disk now, so the UI can offer reload-or-keep
          // without a second round trip.
          setBuffers((prev) =>
            prev.map((b) =>
              b.id === buffer.id
                ? {
                    ...b,
                    conflict: {
                      modifiedAt: stale.modifiedAt ?? "",
                      content: stale.content ?? "",
                    },
                  }
                : b,
            ),
          );
        }
      }),
    );

    setSaveState(failed ? "error" : editSeq.current === seq ? "saved" : "unsaved");
  }, [buffers, getClient]);

  React.useEffect(() => {
    if (!enabled || !autosave || saveState !== "unsaved") return;
    const timer = setTimeout(() => void commitSave(), autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [enabled, autosave, autosaveDelayMs, saveState, commitSave, buffers]);

  /* ----------------------------------------------------------------- runs */

  const run = React.useCallback(
    async (sql?: string): Promise<string | undefined> => {
      const text = (sql ?? activeBuffer?.content ?? "").trim();
      if (!text || !connectionId) return undefined;

      // The client owns the id: cancel needs an address before the run is over.
      const runId = crypto.randomUUID();
      const pending: RunRecord = {
        id: runId,
        connectionId,
        database: database ?? connection?.database ?? "",
        sql: text,
        status: "running",
        startedAt: new Date().toISOString(),
        source: "ui",
      };
      setRuns((prev) => [pending, ...prev].slice(0, RUN_CAP));
      setSelectedRunId(runId);
      setPanel("outputOpen", true);

      try {
        const record = await getClient().query.runSync({
          connectionId,
          sql: text,
          runId,
          source: "ui",
          ...(database ? { database } : {}),
          ...(settingsData ? { maxRows: settingsData.maxRows } : {}),
          ...(settingsData ? { timeoutMs: settingsData.statementTimeoutMs } : {}),
        });
        setRuns((prev) => prev.map((r) => (r.id === runId ? record : r)));
        // DDL moves the ground under the schema tree, so re-introspect rather than wait for the
        // user to notice a table that is not there.
        if ((record.results ?? []).some((result) => DDL.test(result.command ?? ""))) {
          setSchemaNonce((n) => n + 1);
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
    [activeBuffer?.content, connection?.database, connectionId, database, getClient, setPanel, settingsData],
  );

  /* --------------------------------------------------------------- events */

  const onServerEvent = React.useCallback(
    (event: ServerEvent): void => {
      // A `run` event is this client's own run coming back; the record is already held.
      if (event.type === "roots") {
        refresh("settings");
        refresh("workspace");
        return;
      }
      if (event.type !== "file") return;
      const change = event.event;
      if (change.type !== "change") {
        // The listing moved. An open buffer stays open: its text is the last copy that exists.
        refresh("workspace");
        return;
      }
      if (change.created) refresh("workspace");

      const buffer = buffers.find((b) => b.path === change.path);
      if (!buffer) return;
      // The server suppresses the echo of our own writes; this is the belt to that's braces.
      if (readAt.current.get(buffer.id) === change.modifiedAt) return;

      void (async () => {
        try {
          const file = await getClient().files.read(change.path);
          if (buffer.dirty) {
            // Someone else edited the file while there were unsaved changes here. Offer both.
            setBuffers((prev) =>
              prev.map((b) =>
                b.id === buffer.id
                  ? { ...b, conflict: { modifiedAt: file.modifiedAt, content: file.content } }
                  : b,
              ),
            );
            return;
          }
          readAt.current.set(buffer.id, file.modifiedAt);
          setBuffers((prev) =>
            prev.map((b) => (b.id === buffer.id && !b.dirty ? { ...b, content: file.content } : b)),
          );
        } catch {
          /* the file moved again between the event and the read; the next event will say so */
        }
      })();
    },
    [buffers, getClient, refresh],
  );

  // Held in a ref so the subscription below is opened once and not torn down on every keystroke.
  const handler = React.useRef(onServerEvent);
  React.useEffect(() => {
    handler.current = onServerEvent;
  }, [onServerEvent]);

  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let delay = RECONNECT_MIN_MS;
      while (!signal.aborted) {
        try {
          for await (const event of getClient().events({ signal })) {
            delay = RECONNECT_MIN_MS; // a frame arrived, so the connection is healthy again
            handler.current(event);
          }
        } catch {
          /* the stream dropped — a restarted server, a sleeping laptop, a proxy timeout */
        }
        if (signal.aborted) return;
        await sleep(delay, signal);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      }
    })();
    return () => controller.abort();
  }, [enabled, getClient]);

  /* ------------------------------------------------------------------ api */

  const retry = React.useCallback((): void => {
    setServerStatus((previous) => (previous === "ready" ? previous : "connecting"));
    setProbeNonce((n) => n + 1);
  }, []);

  const server = React.useMemo<ServerState>(
    // Building a client during render to read its `baseUrl` is not allowed; this is the same answer.
    () => ({ status: serverStatus, url: injected?.baseUrl ?? serverBaseUrl(), retry, queriesDir }),
    [serverStatus, injected, retry, queriesDir],
  );

  return {
    connections,
    connectionId,
    connection,
    database,
    databases,

    connect: async (nextId, nextDatabase) => {
      try {
        const summary = await getClient().connections.connect(nextId);
        setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
        setConnectionId(nextId);
        setDatabase(nextDatabase ?? summary.database);
      } catch (error) {
        setConnections((prev) => asyncError(messageOf(error), prev));
      }
    },
    selectDatabase: async (next) => setDatabase(next),

    addConnection: async (input: ConnectionInput): Promise<ConnectionSummary> => {
      try {
        const summary = await getClient().connections.create({ ...input });
        setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
        return summary;
      } catch (error) {
        const message = messageOf(error);
        setConnections((prev) => asyncError(message, prev));
        throw new Error(message);
      }
    },
    updateConnection: async (id, patch): Promise<ConnectionSummary> => {
      try {
        const summary = await getClient().connections.update(id, { ...patch });
        setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
        return summary;
      } catch (error) {
        const message = messageOf(error);
        setConnections((prev) => asyncError(message, prev));
        throw new Error(message);
      }
    },
    removeConnection: async (id) => {
      try {
        await getClient().connections.remove(id);
        setConnections((prev) => asyncReady((asyncData(prev) ?? []).filter((c) => c.id !== id)));
        if (connectionId === id) {
          setConnectionId(null);
          setDatabase(null);
        }
      } catch (error) {
        setConnections((prev) => asyncError(messageOf(error), prev));
      }
    },
    /** Rejects on purpose: the contract says so, and a dialog needs the message. */
    testConnection: async (id): Promise<ConnectionTest> => {
      try {
        return await getClient().connections.test(id);
      } catch (error) {
        throw new Error(messageOf(error));
      }
    },
    /** Also rejects: the result is the whole answer, so there is nothing to degrade to. */
    discoverServers: async (): Promise<DiscoveryResult> => {
      try {
        return await getClient().discover();
      } catch (error) {
        throw new Error(messageOf(error));
      }
    },

    schema,
    refreshSchema: async () => setSchemaNonce((n) => n + 1),

    buffers,
    activeBufferId,
    activeBuffer,
    saveState,

    newScratch: () => {
      const n = ++scratchCount.current;
      // A scratch is never dirty: dirty means "differs from disk", and there is no disk copy.
      const buffer: Buffer = {
        id: `scratch:${n}`,
        path: null,
        name: `Query ${n}`,
        content: "",
        dirty: false,
        view: "script",
      };
      setBuffers((prev) => [...prev, buffer]);
      setActiveBufferId(buffer.id);
      return buffer.id;
    },
    openFile: async (path) => {
      const id = bufferIdFor(path);
      if (buffers.some((b) => b.id === id)) {
        setActiveBufferId(id);
        return id;
      }
      try {
        const file = await getClient().files.read(path);
        // The server answers with the resolved path, which is the one writes have to use.
        const openedId = bufferIdFor(file.path);
        readAt.current.set(openedId, file.modifiedAt);
        setBuffers((prev) =>
          prev.some((b) => b.id === openedId)
            ? prev
            : [...prev, fileBuffer(file.path, file.content)],
        );
        setActiveBufferId(openedId);
        return openedId;
      } catch (error) {
        // No state of its own to fail into; the Files tab is where a missing file shows up.
        setWorkspace((prev) => asyncError(messageOf(error), prev));
        return id;
      }
    },
    closeBuffer: (id) => {
      readAt.current.delete(id);
      setBuffers((prev) => {
        const next = prev.filter((b) => b.id !== id);
        setActiveBufferId((current) => (current === id ? (next.at(-1)?.id ?? null) : current));
        return next;
      });
    },
    focusBuffer: setActiveBufferId,
    editBuffer: (id, content) => {
      const target = buffers.find((b) => b.id === id);
      if (!target) return;
      // Only a file can be unsaved: a dirty scratch would nag forever with nowhere to be written.
      const isFile = target.path !== null;
      setBuffers((prev) =>
        prev.map((b) => (b.id === id ? { ...b, content, dirty: isFile } : b)),
      );
      if (!isFile) return;
      editSeq.current += 1;
      setSaveState("unsaved");
    },
    setBufferView: (id, view) =>
      setBuffers((prev) => prev.map((b) => (b.id === id ? { ...b, view } : b))),
    save: commitSave,
    saveAs: async (id, path) => {
      const buffer = buffers.find((b) => b.id === id);
      if (!buffer) return;
      setSaveState("saving");
      try {
        const files = getClient().files;
        let target = path;
        try {
          target = (await files.create(dirName(path), fileName(path))).path;
        } catch (error) {
          // Saving onto an existing file is a legitimate "save as"; anything else is not.
          if (!isPerchError(error) || error.status !== 409) throw error;
        }
        const written = await files.write({ path: target, content: buffer.content });
        const nextId = bufferIdFor(target);
        readAt.current.delete(id);
        readAt.current.set(nextId, written.modifiedAt);
        setBuffers((prev) =>
          prev.map((b) =>
            b.id === id
              ? withoutConflict({
                  ...b,
                  id: nextId,
                  path: target,
                  name: fileName(target),
                  dirty: false,
                })
              : b,
          ),
        );
        setActiveBufferId((current) => (current === id ? nextId : current));
        setSaveState("saved");
        refresh("workspace");
      } catch {
        setSaveState("error");
      }
    },

    workspace,
    // The roots the server actually serves — `--dir` adds roots Settings.workspaces never sees.
    roots: serverRoots.length > 0 ? serverRoots : (settingsData?.workspaces ?? []),
    refreshWorkspace: async () => {
      const controller = new AbortController();
      await loadWorkspace(controller.signal);
    },

    cursor,
    setCursor,

    runs,
    activeRun: runs.find((r) => r.id === selectedRunId) ?? runs[0],
    run,
    exportUrl: (runId, options) => {
      // Runs age out of server memory, so a link is only offered while the rows are still held.
      const held = runs.find((r) => r.id === runId);
      if (!held || held.status !== "done") return null;
      return getClient().runs.exportUrl(runId, options);
    },
    cancelRun: async (runId) => {
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
    selectRun: setSelectedRunId,

    settings,
    updateSettings: async (patch) => {
      try {
        setSettings(asyncReady(await getClient().settings.update(patch)));
      } catch (error) {
        setSettings((prev) => asyncError(messageOf(error), prev));
        // Rethrown, unlike the others: a form is waiting on this one, and swallowing a rejected
        // workspace path would show a "Saved" tick over a patch the server refused.
        throw error;
      }
    },

    server,
    browse: (path) => getClient().browse(path === undefined ? {} : { path }),
    resolveConflict: async (id, choice) => {
      const buffer = buffers.find((b) => b.id === id);
      const conflict = buffer?.conflict;
      if (!buffer || !conflict || buffer.path === null) return;

      if (choice === "reload") {
        readAt.current.set(id, conflict.modifiedAt);
        setBuffers((prev) =>
          prev.map((b) =>
            b.id === id ? withoutConflict({ ...b, content: conflict.content, dirty: false }) : b,
          ),
        );
        setSaveState("saved");
        return;
      }

      // "keep" writes without `ifModifiedAt`: guarding against the version just discarded would
      // refuse the write forever.
      setSaveState("saving");
      try {
        const written = await getClient().files.write({
          path: buffer.path,
          content: buffer.content,
        });
        readAt.current.set(id, written.modifiedAt);
        setBuffers((prev) =>
          prev.map((b) => (b.id === id ? withoutConflict({ ...b, dirty: false }) : b)),
        );
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },

    panels,
    setPanel,
    togglePanel,
  };
}
