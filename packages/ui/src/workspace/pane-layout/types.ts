/** A leaf of the grid: one editor buffer, or the results surface. */
export type PaneId = string;

/** The results pane. There is only ever one, so its id is a constant rather than a generated one. */
export const RESULTS_PANE: PaneId = "results";

const BUFFER_PREFIX = "buffer:";

export function bufferPaneId(bufferId: string): PaneId {
  return `${BUFFER_PREFIX}${bufferId}`;
}

/** The buffer behind a pane, or null for a pane that is not one (today: the results pane). */
export function paneBufferId(pane: PaneId): string | null {
  return pane.startsWith(BUFFER_PREFIX) ? pane.slice(BUFFER_PREFIX.length) : null;
}

/** A tab strip and the pane it is showing. The only node that holds panes. */
export type PaneGroup = {
  readonly kind: "group";
  readonly id: string;
  readonly panes: readonly PaneId[];
  /** Null only while the group is empty, which is the "No file open" state. */
  readonly activePane: PaneId | null;
};

/** A split. `row` puts its children side by side, `column` stacks them. */
export type PaneBranch = {
  readonly kind: "branch";
  readonly id: string;
  readonly direction: "row" | "column";
  readonly children: readonly PaneNode[];
  /** Percent per child — always `children.length` long, always summing to 100. */
  readonly sizes: readonly number[];
};

export type PaneNode = PaneGroup | PaneBranch;

export type EditorLayout = {
  readonly root: PaneNode;
  /** Where a newly opened buffer lands, and whose active pane the Run/Save hotkeys act on. */
  readonly focusedGroup: string;
};

/** Where a dragged tab is headed: into the group's strip, or against one of its four edges. */
export type DropEdge = "center" | "left" | "right" | "top" | "bottom";

/** Where a pane goes when it reappears after being closed. See `reconcile`. */
export type PaneHome = {
  readonly edge: Exclude<DropEdge, "center">;
  /** Percent of the space it will share with the group it splits. */
  readonly size: number;
};
