// The WorkspaceApi over recordings. Every surface in @perch/ui reads this contract and nothing
// else, so the components are the shipped ones and only the transport differs: where the live
// provider asks `perch serve`, this answers from what `perch serve` said while recording. Edits,
// tabs, settings and panels live in memory; runs replay; nothing that was not recorded is invented.

import type {
  ConnectionSummary,
  DatabaseSchema,
  FileEntry,
  HistoryScope,
  RunRecord,
  Settings,
  StatementResult,
} from "@perch/protocol";
import {
  ConnectFailed,
  RESULTS_PANE,
  asyncError,
  asyncReady,
  asyncRefreshing,
  baseName,
  isUnder,
  type Async,
  type Buffer,
  type CursorPosition,
  type EditorLayout,
  type PanelState,
  type Run,
  type SaveState,
  type WorkspaceApi,
} from "@perch/ui";
import { exportCsvUrl } from "./export-csv";
import { normaliseSql } from "./normalise";
import type { Recording, ReplayInput, ReplayWorkspace } from "./types";

/** What an unrecorded query gets instead of rows. */
export const REPLAY_NOTICE =
  "This preview replays recorded queries — install Perch to run your own.";

const NEEDS_MACHINE =
  "This preview has no machine behind it — install Perch to connect your own databases.";

/** The app's first-run grid (apps/web use-panels): queries above, results below. */
const DEFAULT_LAYOUT: EditorLayout = {
  root: {
    kind: "branch",
    id: "branch-root",
    direction: "column",
    children: [
      { kind: "group", id: "group-editor", panes: [], activePane: null },
      { kind: "group", id: "group-results", panes: [RESULTS_PANE], activePane: RESULTS_PANE },
    ],
    sizes: [62, 38],
  },
  focusedGroup: "group-editor",
};

const DEFAULT_PANELS: PanelState = {
  sidebarOpen: true,
  sidebarWidth: 256,
  sidebarTab: "schema",
  outputOpen: true,
  resultsView: "results",
  paletteOpen: false,
  layout: DEFAULT_LAYOUT,
};

const RUN_CAP = 100;
const SAVE_MS = 140;

type DiskFile = { content: string; modifiedAt: string };

type State = {
  connections: Async<readonly ConnectionSummary[]>;
  connectionId: string | null;
  /** The visitor's database pick, or null to follow the connection's own. */
  picked: string | null;
  schemaStale: boolean;
  buffers: readonly Buffer[];
  activeBufferId: string | null;
  savePhase: "idle" | "saving" | "error";
  cursor: CursorPosition;
  runs: readonly Run[];
  selected: { readonly id: string; readonly fromHistory: boolean } | null;
  historyScope: HistoryScope;
  settings: Async<Settings>;
  panels: PanelState;
  disk: ReadonlyMap<string, DiskFile>;
  workspace: Async<readonly FileEntry[]>;
};

export function createReplayWorkspace(input: ReplayInput): ReplayWorkspace {
  const { fixtures } = input;
  const recordings = indexRecordings([...fixtures.recordings, ...(input.extraRecordings ?? [])]);
  const latency = input.latency ?? defaultLatency;
  const roots = fixtures.roots;
  const notebooks = new Set(input.notebook ?? []);
  let scratchCount = 0;

  const initial = (): State => {
    const disk = new Map<string, DiskFile>();
    for (const file of fixtures.files) {
      disk.set(file.path, { content: file.content, modifiedAt: file.modifiedAt });
    }
    for (const [path, content] of Object.entries(input.files ?? {})) {
      disk.set(path, { content, modifiedAt: disk.get(path)?.modifiedAt ?? fixtures.recordedAt });
    }
    const buffers = (input.open ?? []).flatMap((path) => {
      const file = disk.get(path);
      return file ? [fileBuffer(path, file.content, notebooks.has(path))] : [];
    });
    const active = input.active ?? input.open?.at(-1);
    const first =
      fixtures.connections.find((c) => c.status === "connected") ?? fixtures.connections[0];
    scratchCount = 0;
    return {
      connections: asyncReady(fixtures.connections),
      connectionId: first?.id ?? null,
      picked: null,
      schemaStale: false,
      buffers,
      activeBufferId: active ? bufferIdFor(active) : (buffers.at(-1)?.id ?? null),
      savePhase: "idle",
      cursor: { line: 1, col: 1 },
      runs: [],
      selected: null,
      historyScope: "workspace",
      settings: asyncReady(fixtures.settings),
      panels: { ...DEFAULT_PANELS, ...input.panels },
      disk,
      workspace: asyncReady(fixtures.workspace),
    };
  };

  let state = initial();
  /** Bumped by `reset`, so a timer from before it lands on nothing. */
  let generation = 0;
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<State>): void => {
    state = { ...state, ...patch };
    snapshot = build();
    for (const listener of listeners) listener();
  };

  /** Runs `fn` later unless the store was reset in between. */
  const later = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const at = generation;
    return setTimeout(() => {
      if (at === generation) fn();
    }, ms);
  };

  const connectionOf = (id: string | null): ConnectionSummary | undefined =>
    id === null ? undefined : fixtures.connections.find((c) => c.id === id) ??
      (state.connections.status === "ready"
        ? state.connections.data.find((c) => c.id === id)
        : undefined);

  const currentDatabase = (): string | null =>
    state.picked ?? connectionOf(state.connectionId)?.database ?? null;

  const activeBuffer = (): Buffer | undefined =>
    state.buffers.find((b) => b.id === state.activeBufferId);

  const runWorkspace = (): string => {
    const path = activeBuffer()?.path;
    if (!path) return "";
    let best = "";
    for (const root of roots) if (isUnder(path, root) && root.length > best.length) best = root;
    return best;
  };

  /** The recorded answer for `sql`, or the honest notice. Never rows that were not returned. */
  const answer = (sql: string, base: RunRecord, maxRows?: number): { record: RunRecord; ms: number } => {
    const recording = recordings.get(normaliseSql(sql));
    const started = new Date();
    if (!recording) {
      const finished = new Date(started.getTime() + 1);
      return {
        ms: latency(0),
        record: {
          ...base,
          status: "done",
          finishedAt: finished.toISOString(),
          results: [notice(sql)],
        },
      };
    }
    const recorded = recording.record;
    const ms = recorded.durationMs ?? 0;
    const results = (recorded.results ?? []).map((result) => cut(result, maxRows));
    return {
      ms: latency(ms),
      record: {
        ...base,
        status: recorded.status,
        durationMs: recorded.durationMs,
        results,
        ...(recorded.error ? { error: recorded.error } : {}),
      },
    };
  };

  const scheduleAutosave = (): void => {
    clearTimeout(autosaveTimer);
    const settings = state.settings.status === "ready" ? state.settings.data : fixtures.settings;
    if (!settings.autosave) return;
    autosaveTimer = later(settings.autosaveDelayMs, () => void save());
  };

  const save = async (): Promise<void> => {
    const dirty = state.buffers.filter((b) => b.path !== null && b.dirty);
    if (dirty.length === 0) {
      if (state.savePhase === "saving") set({ savePhase: "idle" });
      return;
    }
    set({ savePhase: "saving" });
    await wait(SAVE_MS);
    const disk = new Map(state.disk);
    const now = new Date().toISOString();
    const written = new Map(dirty.map((b) => [b.id, b.content]));
    for (const buffer of dirty) disk.set(buffer.path!, { content: buffer.content, modifiedAt: now });
    set({
      disk,
      savePhase: "idle",
      // Keystrokes that landed during the write stay dirty, for the next save.
      buffers: state.buffers.map((b) =>
        written.has(b.id) ? { ...b, dirty: b.content !== written.get(b.id) } : b,
      ),
      workspace: asyncReady(listing(disk)),
    });
  };

  const listing = (disk: ReadonlyMap<string, DiskFile>): FileEntry[] => {
    const known = new Map(fixtures.workspace.map((entry) => [entry.path, entry]));
    const files = [...disk].map(([path, file]): FileEntry => ({
      ...(known.get(path) ?? { path, name: baseName(path), kind: "file" as const }),
      size: new TextEncoder().encode(file.content).length,
      modifiedAt: file.modifiedAt,
    }));
    const dirs = fixtures.workspace.filter((entry) => entry.kind === "dir");
    return [...dirs, ...files].sort((a, b) => a.path.localeCompare(b.path));
  };

  const api = {
    connect: async (connectionId: string, database?: string): Promise<void> => {
      if (!fixtures.connections.some((c) => c.id === connectionId)) {
        throw new ConnectFailed(NEEDS_MACHINE, "unreachable");
      }
      set({ connectionId, picked: database ?? null });
    },
    selectDatabase: async (database: string): Promise<void> => set({ picked: database }),
    addConnection: async (input: Parameters<WorkspaceApi["addConnection"]>[0]) => {
      const list = state.connections.status === "ready" ? state.connections.data : [];
      const summary: ConnectionSummary = {
        id: crypto.randomUUID(),
        name: input.name,
        dialect: input.dialect ?? "postgres",
        host: input.host ?? "localhost",
        port: input.port ?? (input.dialect === "mysql" ? 3306 : 5432),
        user: input.user ?? "",
        database: input.database ?? "",
        createdAt: new Date().toISOString(),
        status: "disconnected",
      };
      set({ connections: asyncReady([...list, summary]) });
      return summary;
    },
    updateConnection: async (connectionId: string, patch: Parameters<WorkspaceApi["updateConnection"]>[1]) => {
      const list = state.connections.status === "ready" ? state.connections.data : [];
      const current = list.find((c) => c.id === connectionId);
      if (!current) throw new Error("No such connection.");
      // A password is write-only and a URL is the server's to parse; neither belongs in a summary.
      const fields = Object.entries(patch).filter(([key]) => key !== "password" && key !== "url");
      const next: ConnectionSummary = { ...current, ...Object.fromEntries(fields) };
      set({ connections: asyncReady(list.map((c) => (c.id === connectionId ? next : c))) });
      return next;
    },
    removeConnection: async (connectionId: string): Promise<void> => {
      const list = state.connections.status === "ready" ? state.connections.data : [];
      const rest = list.filter((c) => c.id !== connectionId);
      set({
        connections: asyncReady(rest),
        ...(state.connectionId === connectionId
          ? { connectionId: rest[0]?.id ?? null, picked: null }
          : {}),
      });
    },
    testConnection: async (connectionId: string) => {
      const test = fixtures.connectionTests[connectionId];
      if (!test) throw new Error(NEEDS_MACHINE);
      await wait(Math.max(120, test.latencyMs));
      return test;
    },
    discoverServers: async () => {
      await wait(fixtures.discovery.durationMs);
      return fixtures.discovery;
    },

    refreshSchema: async (): Promise<void> => {
      set({ schemaStale: true });
      await wait(180);
      set({ schemaStale: false });
    },

    newScratch: (): string => {
      const n = ++scratchCount;
      const buffer: Buffer = {
        id: `scratch:${n}`,
        path: null,
        name: `Query ${n}`,
        content: "",
        dirty: false,
        view: "script",
      };
      set({ buffers: [...state.buffers, buffer], activeBufferId: buffer.id });
      return buffer.id;
    },
    openFile: async (path: string): Promise<string | null> => {
      const id = bufferIdFor(path);
      if (state.buffers.some((b) => b.id === id)) {
        set({ activeBufferId: id });
        return id;
      }
      const file = state.disk.get(path);
      if (!file) {
        set({ workspace: asyncError(`${baseName(path)} is not in this preview.`, state.workspace) });
        return null;
      }
      set({
        buffers: [...state.buffers, fileBuffer(path, file.content, notebooks.has(path))],
        activeBufferId: id,
      });
      return id;
    },
    closeBuffer: (id: string): void => {
      const buffers = state.buffers.filter((b) => b.id !== id);
      if (buffers.length === state.buffers.length) return;
      set({
        buffers,
        activeBufferId:
          state.activeBufferId === id ? (buffers.at(-1)?.id ?? null) : state.activeBufferId,
      });
    },
    focusBuffer: (id: string | null): void => {
      if (state.activeBufferId !== id) set({ activeBufferId: id });
    },
    editBuffer: (id: string, content: string): void => {
      const target = state.buffers.find((b) => b.id === id);
      if (!target || target.content === content) return;
      const isFile = target.path !== null;
      set({
        buffers: state.buffers.map((b) => (b.id === id ? { ...b, content, dirty: isFile } : b)),
        savePhase: isFile ? "idle" : state.savePhase,
      });
      if (isFile) scheduleAutosave();
    },
    setBufferView: (id: string, view: Buffer["view"]): void => {
      set({ buffers: state.buffers.map((b) => (b.id === id ? { ...b, view } : b)) });
    },
    save,
    saveAs: async (id: string, path: string): Promise<void> => {
      const buffer = state.buffers.find((b) => b.id === id);
      if (!buffer) return;
      set({ savePhase: "saving" });
      await wait(SAVE_MS);
      const current = state.buffers.find((b) => b.id === id) ?? buffer;
      const disk = new Map(state.disk);
      disk.set(path, { content: current.content, modifiedAt: new Date().toISOString() });
      const nextId = bufferIdFor(path);
      set({
        disk,
        workspace: asyncReady(listing(disk)),
        savePhase: "idle",
        buffers: state.buffers.map((b) =>
          b.id === id ? { ...b, id: nextId, path, name: baseName(path), dirty: false } : b,
        ),
        activeBufferId: state.activeBufferId === id ? nextId : state.activeBufferId,
      });
    },
    resolveConflict: async (): Promise<void> => {
      // Nothing changes on disk behind a replay, so there is never a conflict to resolve.
    },

    refreshWorkspace: async (): Promise<void> => set({ workspace: asyncReady(listing(state.disk)) }),

    setCursor: (cursor: CursorPosition): void => {
      if (cursor.line !== state.cursor.line || cursor.col !== state.cursor.col) set({ cursor });
    },

    run: async (sql?: string): Promise<string | undefined> => {
      const text = (sql ?? activeBuffer()?.content ?? "").trim();
      const connectionId = state.connectionId;
      if (!text || !connectionId) return undefined;
      const runId = crypto.randomUUID();
      const workspace = runWorkspace();
      const pending: RunRecord = {
        id: runId,
        connectionId,
        database: currentDatabase() ?? "",
        sql: text,
        status: "running",
        startedAt: new Date().toISOString(),
        source: "ui",
        ...(workspace ? { workspace } : {}),
      };
      set({
        runs: [pending, ...state.runs].slice(0, RUN_CAP),
        selected: { id: runId, fromHistory: false },
        panels: { ...state.panels, outputOpen: true },
      });
      const { record, ms } = answer(text, pending);
      await new Promise<void>((resolve) => {
        later(ms, () => {
          const held = state.runs.find((r) => r.id === runId);
          // Cancelled while it was "running": the cancel already wrote the outcome.
          if (held?.status === "running") {
            const finished = new Date(Date.parse(pending.startedAt) + ms).toISOString();
            set({ runs: state.runs.map((r) => (r.id === runId ? { ...record, finishedAt: finished } : r)) });
          }
          resolve();
        });
      });
      return runId;
    },
    cancelRun: async (runId: string): Promise<void> => {
      set({
        runs: state.runs.map((r) =>
          r.id === runId && r.status === "running"
            ? { ...r, status: "cancelled", finishedAt: new Date().toISOString() }
            : r,
        ),
      });
    },
    selectRun: (runId: string): void => set({ selected: { id: runId, fromHistory: true } }),
    exportUrl: (runId: string, options?: { statement?: number; format?: "csv" | "json" }) => {
      const run = state.runs.find((r) => r.id === runId);
      if (!run || run.status !== "done" || (options?.format ?? "csv") !== "csv") return null;
      const statement = run.results?.[options?.statement ?? 0];
      return statement && statement.columns.length > 0 ? exportCsvUrl(statement) : null;
    },
    probe: async (sql: string, options?: { maxRows?: number }): Promise<RunRecord> => {
      const text = sql.trim();
      if (!text) throw new Error("Nothing to run.");
      const connectionId = state.connectionId;
      if (!connectionId) throw new Error("No connection selected.");
      const base: RunRecord = {
        id: crypto.randomUUID(),
        connectionId,
        database: currentDatabase() ?? "",
        sql: text,
        status: "running",
        startedAt: new Date().toISOString(),
        source: "ui",
      };
      const { record, ms } = answer(text, base, options?.maxRows);
      await wait(ms);
      return { ...record, finishedAt: new Date().toISOString() };
    },
    historyStats: async () => {
      const bytes = JSON.stringify(state.runs.map(({ results: _results, ...header }) => header)).length;
      return { runs: state.runs.length, bytes, fileBytes: Math.max(bytes, 4096) };
    },
    clearHistory: async (): Promise<void> => {
      const running = state.runs.filter((r) => r.status === "running");
      set({
        runs: running,
        selected:
          state.selected && running.some((r) => r.id === state.selected!.id) ? state.selected : null,
      });
    },
    setHistoryScope: (historyScope: HistoryScope): void => set({ historyScope }),

    updateSettings: async (patch: Partial<Settings>): Promise<void> => {
      const current = state.settings.status === "ready" ? state.settings.data : fixtures.settings;
      set({ settings: asyncReady({ ...current, ...patch }) });
    },
    browse: async () => {
      throw new Error(NEEDS_MACHINE);
    },

    setPanel: <K extends keyof PanelState>(key: K, value: PanelState[K]): void => {
      if (state.panels[key] === value) return;
      set({ panels: { ...state.panels, [key]: value } });
    },
    togglePanel: (key: "sidebarOpen" | "outputOpen" | "paletteOpen"): void => {
      set({ panels: { ...state.panels, [key]: !state.panels[key] } });
    },
  } satisfies Partial<WorkspaceApi>;

  const server: WorkspaceApi["server"] = {
    status: "ready",
    url: fixtures.server.url,
    retry: () => {},
    queriesDir: fixtures.server.queriesDir,
  };

  const schemaCache = new Map<string, Async<DatabaseSchema>>();
  const schemaFor = (connectionId: string | null, database: string | null, stale: boolean): Async<DatabaseSchema> => {
    if (!connectionId || !database) return { status: "idle" };
    const key = `${connectionId}/${database}/${stale}`;
    let value = schemaCache.get(key);
    if (!value) {
      const recorded = fixtures.schemas[`${connectionId}/${database}`];
      value = recorded
        ? stale
          ? asyncRefreshing(asyncReady(recorded))
          : asyncReady(recorded)
        : asyncError(`This preview recorded one database — install Perch to browse ${database}.`);
      schemaCache.set(key, value);
    }
    return value;
  };

  const databasesCache = new Map<string, Async<readonly string[]>>();
  const databasesFor = (connectionId: string | null): Async<readonly string[]> => {
    if (!connectionId) return { status: "idle" };
    let value = databasesCache.get(connectionId);
    if (!value) {
      const list = fixtures.databases[connectionId] ?? connectionOf(connectionId)?.databases;
      value = list ? asyncReady(list) : asyncError(NEEDS_MACHINE);
      databasesCache.set(connectionId, value);
    }
    return value;
  };

  const build = (): WorkspaceApi => {
    const database = currentDatabase();
    const active = activeBuffer();
    const selectedRun = state.selected ? state.runs.find((r) => r.id === state.selected!.id) : undefined;
    const connection =
      state.connections.status === "ready"
        ? state.connections.data.find((c) => c.id === state.connectionId)
        : undefined;
    return {
      ...api,
      connections: state.connections,
      connectionId: state.connectionId,
      connection,
      database,
      databases: databasesFor(state.connectionId),
      schema: schemaFor(state.connectionId, database, state.schemaStale),
      buffers: state.buffers,
      activeBufferId: state.activeBufferId,
      activeBuffer: active,
      saveState: saveStateOf(state),
      workspace: state.workspace,
      roots,
      cursor: state.cursor,
      runs: state.runs,
      activeRun: selectedRun ?? state.runs[0],
      activeRunFromHistory: selectedRun ? state.selected!.fromHistory : true,
      historyScope: state.historyScope,
      settings: state.settings,
      server,
      panels: state.panels,
    };
  };

  let snapshot = build();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => {
      generation++;
      clearTimeout(autosaveTimer);
      state = initial();
      snapshot = build();
      for (const listener of listeners) listener();
    },
  };
}

function bufferIdFor(path: string): string {
  return `file:${path}`;
}

function fileBuffer(path: string, content: string, notebook: boolean): Buffer {
  return {
    id: bufferIdFor(path),
    path,
    name: baseName(path),
    content,
    dirty: false,
    view: notebook ? "notebook" : "script",
  };
}

function saveStateOf(state: State): SaveState {
  if (state.savePhase === "saving") return "saving";
  if (state.savePhase === "error") return "error";
  return state.buffers.some((b) => b.path !== null && b.dirty) ? "unsaved" : "saved";
}

/** The server's round trip on loopback, plus what the database took. */
function defaultLatency(recordedMs: number): number {
  return Math.min(1500, Math.max(90, Math.round(recordedMs + 60)));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function indexRecordings(list: readonly Recording[]): ReadonlyMap<string, Recording> {
  const map = new Map<string, Recording>();
  for (const recording of list) {
    map.set(recording.key || normaliseSql(recording.request.sql), recording);
  }
  return map;
}

/** A `maxRows` below what was recorded cuts the rows the way the server would have. */
function cut(result: StatementResult, maxRows: number | undefined): StatementResult {
  if (maxRows === undefined || result.rows.length <= maxRows) return result;
  return { ...result, rows: result.rows.slice(0, maxRows), rowCount: maxRows, truncated: true };
}

function notice(sql: string): StatementResult {
  return {
    index: 0,
    sql,
    columns: [],
    rows: [],
    rowCount: 0,
    affectedRows: null,
    command: "Not run",
    durationMs: 0,
    truncated: false,
    notices: [REPLAY_NOTICE],
  };
}
