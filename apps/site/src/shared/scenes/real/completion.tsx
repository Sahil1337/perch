import { lazyScene } from "../../replay/stage/lazy-scene";

/** Two JOINs written with completion: related tables ranked first, ON offered from the foreign key. */
export const RealCompletionScene = lazyScene(() => import("./completion.scene"), {
  width: 1280,
  height: 760,
});
