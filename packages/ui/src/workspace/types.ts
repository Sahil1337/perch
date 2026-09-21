// The workspace contract. Every UI surface reads this and nothing else — no component imports
// @perch/client — so components stay independent of the transport. Protocol types are reused
// verbatim; the types here are the ones with no wire equivalent.

import type { EditorLayout } from "./pane-layout";
import type {
  BrowseResult,
  ConnectionSummary,
  DatabaseSchema,
  Dialect,
  DiscoveryResult,
  FileEntry,
  HistoryScope,
  HistoryStats,
  RunRecord,
  Settings,
  StatementResult,
} from "@perch/protocol";


/**
 * Server-backed data. `ready` carries `stale` and `error` keeps the last good data, so refetching
 * never blanks a populated view back to a skeleton.
 */
export type Async<T> =
  | { readonly status: "idle" }
  /** Nothing to show yet — this is the skeleton case. */
  | { readonly status: "loading" }
  /** `stale` means a refetch is in flight; keep rendering `data` and show a quiet indicator. */
  | { readonly status: "ready"; readonly data: T; readonly stale: boolean }
  /** `data` is the last value that loaded, when there was one. Render it under the error. */
  | { readonly status: "error"; readonly error: string; readonly data?: T };

export const asyncIdle: Async<never> = { status: "idle" };
export const asyncLoading: Async<never> = { status: "loading" };
export const asyncReady = <T>(data: T, stale = false): Async<T> => ({
  status: "ready",
  data,
  stale,
});

/** Failure that keeps whatever was already loaded, so the UI degrades instead of emptying. */
export const asyncError = <T>(error: string, previous?: Async<T>): Async<T> => {
  const data = asyncData(previous);
  return data === undefined ? { status: "error", error } : { status: "error", error, data };
};

/** Marks a loaded value as refetching. Anything not yet loaded stays in its loading state. */
export const asyncRefreshing = <T>(previous: Async<T>): Async<T> => {
  const data = asyncData(previous);
  return data === undefined ? asyncLoading : { status: "ready", data, stale: true };
};

/** The most recent data, whatever the status — ready, refetching, or failed after a good load. */
export function asyncData<T>(value: Async<T> | undefined): T | undefined {
  if (!value) return undefined;
  if (value.status === "ready") return value.data;
  if (value.status === "error") return value.data;
  return undefined;
}


/**
 * A buffer open in the editor. `path` tells the two kinds apart: `null` is a scratch query, never
 * written to disk and ignored by autosave, which becomes a file buffer once `saveAs` gives it a
 * path. Otherwise it is backed by a real path under a workspace root, and only the server touches
 * disk. `content`/`dirty` hold keystrokes the server cannot see until a save flushes them.
 */
export type Buffer = {
  /** Stable for the life of the tab, including across a `saveAs` that gives it a path. */
  readonly id: string;
  /** Its path on disk, or null for a scratch buffer. The discriminator between the two kinds. */
  readonly path: string | null;
  /** The tab label. A scratch gets a generated one ("Query 1") until it is saved somewhere. */
  readonly name: string;
  /** The editor buffer. Equal to what is on disk exactly when `dirty` is false. */
  readonly content: string;
  /** Whether the buffer differs from disk. Always false for a scratch: there is no disk copy. */
  readonly dirty: boolean;
  /** How the buffer is presented. `notebook` splits it into cells; see cells.ts. */
  readonly view: "script" | "notebook";
  /** The disk copy at the moment an outside change hit a dirty buffer, for "reload" or "keep mine". */
  readonly conflict?: { readonly modifiedAt: string; readonly content: string };
};

/** A throwaway tab: nothing to save, nothing to lose, no prompt on close. */
export function isScratch(buffer: Buffer): boolean {
  return buffer.path === null;
}

export type SaveState = "saved" | "saving" | "unsaved" | "error";

/**
 * What each save state is called, next to the type so the two places a user reads it — the status
 * bar and the save indicator — cannot drift apart.
 */
export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  error: "Save failed",
};


/**
 * A run, `RunRecord` verbatim. Runs go through `POST /api/query/sync`; the NDJSON route streams the
 * same run event by event but nothing here needs it, since results are capped at `maxRows`. The
 * client generates `runId` when submitting so it has something to cancel with.
 */
export type Run = RunRecord;

/** Every statement outcome the run has produced. */
export function runStatements(run: Run): readonly StatementResult[] {
  return run.results ?? [];
}


export type SidebarTab = "schema" | "files" | "history";
export type ResultsView = "results" | "messages";

/** Panel geometry and which surfaces are open. Persisted per user, never sent to the server. */
export type PanelState = {
  /** Which panes are open, how they are split, and which group has focus. Persisted. */
  readonly layout: EditorLayout;
  readonly sidebarOpen: boolean;
  /** Pixels. Clamped by the sidebar itself; stored so a reload keeps the user's width. */
  readonly sidebarWidth: number;
  readonly sidebarTab: SidebarTab;
  /** Whether the results pane is in the grid at all. ⌘J, and the palette's show/hide command. */
  readonly outputOpen: boolean;
  readonly resultsView: ResultsView;
  readonly paletteOpen: boolean;
};


/**
 * What it takes to create or edit a connection. Either a URL (`postgres://user:pass@host/db`,
 * `mysql://…`) or the individual fields; the server parses the URL. `password` is write-only:
 * it never comes back in a `ConnectionSummary`.
 */
export type ConnectionInput = {
  readonly name: string;
  readonly url?: string;
  readonly dialect?: Dialect;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
  readonly ssl?: boolean;
};

export type ConnectionTest = { readonly serverVersion: string; readonly latencyMs: number };


/**
 * Whether the server is there. `connecting` is the first paint; `unreachable` keeps probing so it
 * clears itself; `ready` is the only state in which surfaces below the gate are mounted, which is
 * why they can assume their data is real.
 */
export type ServerStatus = "connecting" | "ready" | "unreachable";

export type ServerState = {
  readonly status: ServerStatus;
  /** Where the app is looking, spelled as a user would have to type it. Shown when it fails. */
  readonly url: string;
  /** Probes again now. Safe to call in any state; a no-op while a probe is already in flight. */
  retry(): void;
  /** The folder perch keeps for itself, offered when an untitled query has nowhere else to go. */
  readonly queriesDir: string | null;
};


export type CursorPosition = { readonly line: number; readonly col: number };

/**
 * What every workspace surface is given. Actions return a promise so a caller can sequence work.
 * A write that only changes the list surfaces its failure as state, because the surface showing
 * that list is what reports it; `connect`, `testConnection` and `discoverServers` reject, because
 * their result is the answer the caller asked for and there is nothing to degrade to.
 */
export type WorkspaceApi = {
  /* connections */
  readonly connections: Async<readonly ConnectionSummary[]>;
  readonly connectionId: string | null;
  readonly connection: ConnectionSummary | undefined;
  readonly database: string | null;
  readonly databases: Async<readonly string[]>;
  /**
   * Opens a connection and points the workspace at it. Rejects with a {@link ConnectFailed}
   * carrying the reason — a caller that is about to cover the screen with a handover animation has
   * to know the dial did not land.
   */
  connect(connectionId: string, database?: string): Promise<void>;
  selectDatabase(database: string): Promise<void>;
  /** Saves a new connection and returns it. Does not connect; call `testConnection` or `connect`. */
  addConnection(input: ConnectionInput): Promise<ConnectionSummary>;
  updateConnection(
    connectionId: string,
    patch: Partial<ConnectionInput>,
  ): Promise<ConnectionSummary>;
  removeConnection(connectionId: string): Promise<void>;
  /** A round trip to the server behind a saved connection; rejects with a readable message. */
  testConnection(connectionId: string): Promise<ConnectionTest>;
  /** Database servers already on this machine — on default ports, a service, Docker, or PATH. */
  discoverServers(): Promise<DiscoveryResult>;

  /* schema */
  readonly schema: Async<DatabaseSchema>;
  /** Re-introspects, bypassing the server's TTL cache. */
  refreshSchema(): Promise<void>;

  /* buffers — the tabs open in the editor */
  readonly buffers: readonly Buffer[];
  readonly activeBufferId: string | null;
  readonly activeBuffer: Buffer | undefined;
  readonly saveState: SaveState;
  /** A throwaway query tab. Returns its id so the caller can configure what it just made. */
  newScratch(): string;
  /**
   * Opens a path from the workspace, or focuses it when already open. Returns the buffer id, or
   * null when the file could not be read — the failure is reported into the Files tab, not thrown.
   */
  openFile(path: string): Promise<string | null>;
  closeBuffer(id: string): void;
  focusBuffer(id: string): void;
  editBuffer(id: string, content: string): void;
  setBufferView(id: string, view: Buffer["view"]): void;
  /** Flushes the active buffer to disk. A no-op for a scratch, which has nowhere to go. */
  save(): Promise<void>;
  /** Gives a buffer a path — the one way a scratch becomes a file. */
  saveAs(id: string, path: string): Promise<void>;

  /* workspace — what is browsable on disk, so `openFile` has something to be called with */
  readonly workspace: Async<readonly FileEntry[]>;
  /**
   * The directories the server will read and write. Derived from `settings`, so check
   * `settings.status` to tell "none configured" apart from "not loaded yet".
   */
  readonly roots: readonly string[];
  refreshWorkspace(): Promise<void>;

  /* editor */
  readonly cursor: CursorPosition;
  setCursor(cursor: CursorPosition): void;

  /* runs */
  readonly runs: readonly Run[];
  readonly activeRun: Run | undefined;
  /** Runs `sql`, or the active buffer when omitted. Resolves with the run's id once it settles. */
  run(sql?: string): Promise<string | undefined>;
  cancelRun(runId: string): Promise<void>;
  /**
   * Points the results pane at a run, fetching its rows if they are not already here. A run older
   * than the server's in-memory window still has them when history was recording results, which is
   * the whole point of recording them.
   */
  selectRun(runId: string): void;
  /**
   * A URL that downloads one statement's rows, or null when the rows are gone: the run aged out of
   * server memory and history was not keeping them. Rendered as a link so the browser handles the
   * download.
   */
  exportUrl(
    runId: string,
    options?: { statement?: number; format?: "csv" | "json" },
  ): string | null;
  /**
   * Runs `sql` against the current connection and database with `record: false` and
   * `readOnly: true`, outside the runs list and outside History. The query walk's step queries go
   * through this. Rejects only for a bad request; SQL failures come back in the record's `error`
   * and statement results.
   */
  probe(sql: string, options?: { maxRows?: number }): Promise<RunRecord>;
  /** What the run history is costing on disk, for the pane that offers to clear it. */
  historyStats(): Promise<HistoryStats>;
  /** Drops every recorded run and its rows. Not undoable; the caller confirms. */
  clearHistory(): Promise<void>;
  /** Which runs History is showing: this folder plus the global ones, everything, or only global. */
  readonly historyScope: HistoryScope;
  setHistoryScope(scope: HistoryScope): void;

  /* settings */
  readonly settings: Async<Settings>;
  /** Writes a settings patch. Rejects when the server refuses it, so a form can show why. */
  updateSettings(patch: Partial<Settings>): Promise<void>;

  /** Whether the server behind all of the above is reachable and will answer. See `ServerState`. */
  readonly server: ServerState;
  /** Lists folders on the server's machine. `path` omitted means the home directory. */
  browse(path?: string): Promise<BrowseResult>;
  /** Resolves a "changed on disk" conflict: take the disk copy, or keep the buffer and overwrite. */
  resolveConflict(id: string, choice: "reload" | "keep"): Promise<void>;

  /* panels */
  readonly panels: PanelState;
  setPanel<K extends keyof PanelState>(key: K, value: PanelState[K]): void;
  togglePanel(key: "sidebarOpen" | "outputOpen" | "paletteOpen"): void;
};
