import { type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useInView, usePrefersReducedMotion } from "../../../shared/motion";
import { BOX_ITEMS } from "./items";
import type { CropState } from "./pane";

const CYCLE_MS = 3500;
// Tailwind's lg: from here the pane sits beside the list.
const BESIDE = "(min-width: 64rem)";
// How far past a step's edge, in steps, the scroll has to go before the next item takes over, so a
// page resting on a boundary never flickers between two.
const HYSTERESIS = 0.12;

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
const clamp = (index: number) => Math.min(count - 1, Math.max(0, index));

/** The track's scroll, in steps: 0 as the stage sticks, `count` as it lets go. */
function stepsAt(track: HTMLElement, stage: HTMLElement): number {
  const box = track.getBoundingClientRect();
  const travel = box.height - stage.offsetHeight;
  return travel > 0 ? (-box.top / travel) * count : 0;
}

export type ShowcaseRefs = {
  pane: RefObject<HTMLElement | null>;
  list: RefObject<HTMLElement | null>;
  /** The pinned layout's scroll track and the stage that sticks inside it. */
  track: RefObject<HTMLElement | null>;
  stage: RefObject<HTMLElement | null>;
};

/**
 * Which item the pane shows.
 *
 * Pinned (lg+, motion allowed), the page's own scroll steps through the items: the track is cut
 * into one even step per item, and whichever step the scroll is in is the item in hand, with a
 * little hysteresis at each edge. Clicking an item scrolls the page to the middle of its step, and
 * the scroll ignores the steps it passes on the way, so the list never flickers through them.
 *
 * Unpinned, with reduced motion at lg, the pane is sticky beside the list instead and follows the
 * item nearest a line that runs down it as it travels, from its top edge when it first sticks to its
 * bottom edge when it lets go. A mouse on an item takes over while it stays on the list.
 *
 * Above the list (under lg), it cycles while the pane is in view and no mouse is on the showcase.
 * Clicking or tapping an item shows it, and the cycle carries on from there. Reduced motion never
 * cycles.
 */
export function useShowcase({ pane, list, track, stage }: ShowcaseRefs) {
  const beside = useMatches(BESIDE);
  const reduced = usePrefersReducedMotion();
  const pinned = beside && !reduced;
  const [active, setActive] = useState(0);
  const [crops, setCrops] = useState<Readonly<Record<string, CropState>>>({});
  const [hovering, setHovering] = useState(false);
  const [paused, setPaused] = useState(false);
  const listInView = useInView(list, { once: false });
  const paneInView = useInView(pane, { once: false, amount: 0.5 });
  // The item a click is scrolling to: the steps passed on the way are not the visitor's choice.
  const aim = useRef<number | null>(null);

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!track.current || !stage.current) return;
      const steps = stepsAt(track.current, stage.current);
      const here = clamp(Math.floor(steps));
      if (aim.current !== null) {
        if (here !== aim.current) return;
        aim.current = null;
      }
      setActive((current) =>
        steps < current - HYSTERESIS || steps > current + 1 + HYSTERESIS ? here : current,
      );
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    // A wheel or a key during a click's scroll takes over from it, so stop waiting for its item.
    const settle = () => {
      if (aim.current === null) return;
      aim.current = null;
      schedule();
    };
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    addEventListener("scrollend", settle);
    addEventListener("wheel", settle, { passive: true });
    addEventListener("touchstart", settle, { passive: true });
    addEventListener("keydown", settle);
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      removeEventListener("scrollend", settle);
      removeEventListener("wheel", settle);
      removeEventListener("touchstart", settle);
      removeEventListener("keydown", settle);
      cancelAnimationFrame(frame);
    };
  }, [pinned, track, stage]);

  useEffect(() => {
    if (!beside || pinned || hovering || !listInView) return;
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
  }, [beside, pinned, hovering, listInView, pane, list]);

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
  const point = useCallback(
    (index: number, hover: boolean) => {
      if (pinned) {
        if (hover || !track.current || !stage.current) return;
        const box = track.current.getBoundingClientRect();
        const travel = box.height - stage.current.offsetHeight;
        aim.current = index;
        setActive(index);
        scrollTo({ top: scrollY + box.top + (travel * (index + 0.5)) / count, behavior: "smooth" });
        return;
      }
      setActive(index);
      if (hover) setHovering(true);
    },
    [pinned, track, stage],
  );
  const release = useCallback(() => setHovering(false), []);

  return { pinned, active, shown, onCrop, point, release, pause: setPaused };
}
