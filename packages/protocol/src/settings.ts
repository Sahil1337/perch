/**
 * How much of a run survives it. `queries` is what perch has always kept — the shape of a run and
 * its counts, never a row — and stays the default: turning on row storage without being asked
 * would put a database's contents in a second place on disk that nobody chose.
 */
export type HistoryMode = "off" | "queries" | "results";

/**
 * What the history store holds. `bytes` is what perch has stored; `fileBytes` is what the file
 * takes up, which is larger and does not shrink when runs are dropped — the store reuses the pages
 * it frees rather than returning them, so the file plateaus instead of growing.
 */
export type HistoryStats = {
  runs: number;
  bytes: number;
  fileBytes: number;
};

export type Settings = {
  autosave: boolean;
  autosaveDelayMs: number;
  maxRows: number;
  statementTimeoutMs: number;
  /** Directories the file API may read/write. Absolute paths. */
  workspaces: string[];
  theme: "dark" | "light";
  /** How the formatter writes keywords. `preserve` leaves them as typed. */
  keywordCase: "preserve" | "upper" | "lower";
  /**
   * Whether the welcome flow has been completed or skipped. Server-side rather than per-browser:
   * a machine that is set up is set up, and a second browser should land in the workspace.
   */
  onboarded: boolean;
  /**
   * Folders that have been workspace roots, newest first — what an editor calls "Recent". Kept
   * when a root is removed, which is the point: closing a folder should not mean losing the path.
   */
  recentWorkspaces: string[];
  /** What a finished run leaves behind. */
  historyMode: HistoryMode;
  /** The oldest run is dropped once either cap is passed. 0 means no cap. */
  historyLimit: number;
  historyMaxMb: number;
};
