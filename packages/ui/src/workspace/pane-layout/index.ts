// The editor grid's shape: which panes exist, how they nest, and which has focus. Pure data and
// pure functions — no React, no DOM — so everything here is a transform from one layout to the next.
//
// Three disciplines make that work:
//
//   Identity is the change signal. Every function returns its argument by reference when nothing
//   changed, because `reconcile` runs during render and writes back through an effect.
//   A pane lives in exactly one group, so `groupOf` has one answer.
//   The tree owns structure, not content: a pane is an id, and nothing here imports a component.

export {
  RESULTS_PANE,
  bufferPaneId,
  paneBufferId,
  type DropEdge,
  type EditorLayout,
  type PaneBranch,
  type PaneGroup,
  type PaneHome,
  type PaneId,
  type PaneNode,
} from "./types";

export { findGroup, groupOf, groups, isGroup, paneGroup, panesOf, singleGroup } from "./tree";

export { activatePane, focusGroup, movePane, openPane, setBranchSizes } from "./operations";

export { reconcile } from "./reconcile";

export { sanitizeLayout } from "./storage";
