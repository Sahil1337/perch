import { type RefObject, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useInView, usePrefersReducedMotion } from "../../../shared/motion";
import { BOX_ITEMS } from "./items";
import type { CropState } from "./pane";

const CYCLE_MS = 3500;
// Tailwind's lg: from here the pane sits beside the list.
const BESIDE = "(min-width: 64rem)";

function useMatches(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}

const count = BOX_ITEMS.length;

/**
 * Which item the pane shows.
 *
 * Beside the list (lg+), it follows the scroll: the item nearest a line that runs down the sticky
 * pane as the pane travels, from its top edge when it first sticks to its bottom edge when it lets
 * go. Through the middle that is the pane's centre; at the two ends it is what lets the first and
 * last items have a turn. A mouse on an item takes over while it stays on the list.
 *
 * Above the list (under lg), it cycles while the pane is in view and no mouse is on the showcase.
 * Clicking or tapping an item shows it, and the cycle carries on from there. Reduced motion never
 * cycles.
 */
export function useShowcase({ pane, list }: { pane: RefObject<HTMLElement | null>; list: RefObject<HTMLElement | null> }) {
  const beside = useMatches(BESIDE);
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [crops, setCrops] = useState<Readonly<Record<string, CropState>>>({});
  const [hovering, setHovering] = useState(false);
  const [paused, setPaused] = useState(false);
  const listInView = useInView(list, { once: false });
  const paneInView = useInView(pane, { once: false, amount: 0.5 });

  useEffect(() => {
    if (!beside || hovering || !listInView) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = pane.current?.getBoundingClientRect();
      // The pane's parent is the grid column it sticks inside.
      const column = pane.current?.parentElement?.getBoundingClientRect();
      const items = list.current?.children;
      if (!box || !column || !items?.length) return;
      const travel = column.height - box.height;
      const progress = travel > 0 ? Math.min(1, Math.max(0, (box.top - column.top) / travel)) : 0;
      const line = box.top + box.height * progress;
      let nearest = 0;
      let distance = Infinity;
      for (const [index, item] of Array.from(items).entries()) {
        const rect = item.getBoundingClientRect();
        const d = Math.abs(rect.top + rect.height / 2 - line);
        if (d < distance) [nearest, distance] = [index, d];
      }
      setActive(nearest);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [beside, hovering, listInView, pane, list]);

  useEffect(() => {
    if (beside || reduced || paused || !paneInView) return;
    const timer = setTimeout(() => {
      for (let step = 1; step < count; step++) {
        const next = (active + step) % count;
        if (crops[BOX_ITEMS[next]?.key ?? ""] !== "failed") return setActive(next);
      }
    }, CYCLE_MS);
    return () => clearTimeout(timer);
  }, [beside, reduced, paused, paneInView, active, crops]);

  // The active item's crop, or if that one failed, the nearest one before it that loaded. Nothing
  // while the active crop is still on its way, rather than a crop for some other item.
  let shown: string | null = null;
  for (let step = 0; step < count; step++) {
    const key = BOX_ITEMS[(active - step + count) % count]?.key ?? "";
    if (crops[key] === "failed") continue;
    if (crops[key] === "loaded") shown = key;
    break;
  }

  const onCrop = useCallback((key: string, state: CropState) => setCrops((all) => ({ ...all, [key]: state })), []);
  const point = useCallback((index: number, hover: boolean) => {
    setActive(index);
    if (hover) setHovering(true);
  }, []);
  const release = useCallback(() => setHovering(false), []);

  return { active, shown, onCrop, point, release, pause: setPaused };
}
