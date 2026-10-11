import { lazyScene } from "../../replay/stage/lazy-scene";

/** The workspace: the tail of a query typed with completion, run, results. Real @perch/ui on replayed data. */
export const RealHeroScene = lazyScene(() => import("./hero.scene"), { width: 1280, height: 760 });
