import { lazyScene } from "../../replay/stage/lazy-scene";

/** A .sql notebook of three `-- %%` cells, run in order. */
export const RealNotebookScene = lazyScene(() => import("./notebook.scene"), {
  width: 1280,
  height: 880,
});
