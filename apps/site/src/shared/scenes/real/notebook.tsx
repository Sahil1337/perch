import { lazyScene } from "../../replay/stage/lazy-scene";

// Laid out as a small laptop's window, so the stage, which fits a window to the view's height, draws
// the app at about 0.8 scale on a laptop rather than shrinking a desktop-sized one.

/** A .sql notebook of three `-- %%` cells, run in order. */
export const RealNotebookScene = lazyScene(() => import("./notebook.scene"), {
  width: 1040,
  height: 760,
});
