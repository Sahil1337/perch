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
};
