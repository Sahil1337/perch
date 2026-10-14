import { lazyScene } from "../../replay/stage/lazy-scene";

// Laid out as a small laptop's window, so the stage, which fits a window to the view's height, draws
// the app at about 0.8 scale on a laptop rather than shrinking a desktop-sized one.

/** Two JOINs written with completion: related tables ranked first, ON offered from the foreign key. */
export const RealCompletionScene = lazyScene(() => import("./completion.scene"), {
  width: 1040,
  height: 720,
});
