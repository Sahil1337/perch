import { lazyScene } from "../../replay/stage/lazy-scene";

// Laid out as a small laptop's window, so the stage, which fits a window to the view's height, draws
// the app at about 0.8 scale on a laptop rather than shrinking a desktop-sized one.

/** The workspace: the tail of a query typed with completion, run, results. Real @perch/ui on replayed data. */
export const RealHeroScene = lazyScene(() => import("./hero.scene"), { width: 1040, height: 720 });
