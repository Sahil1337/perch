import { lazyScene } from "../stage/lazy-scene";

// Laid out as a small laptop's window, so the stage, which fits a window to the view's height, draws
// the app at about 0.8 scale on a laptop rather than shrinking a desktop-sized one.
const LAPTOP = { width: 1040, height: 720 };

/** The workspace: the tail of a query typed with completion, run, results. Real @perch/ui on replayed data. */
export const RealHeroScene = lazyScene(() => import("./workspace/hero.scene"), LAPTOP);

/** Two JOINs written with completion: related tables ranked first, ON offered from the foreign key. */
export const RealCompletionScene = lazyScene(() => import("./workspace/completion.scene"), LAPTOP);

/** A .sql notebook of three `-- %%` cells, run in order. */
export const RealNotebookScene = lazyScene(() => import("./workspace/notebook.scene"), { ...LAPTOP, height: 760 });
