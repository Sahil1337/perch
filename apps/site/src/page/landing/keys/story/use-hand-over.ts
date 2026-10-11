import { type RefObject, useEffect } from "react";
import type { Bird } from "../../../../shared/bird";
import type { TryWindow } from "../../../sections/try/window";
import { clamp, smoothstep } from "../../math";
import type { Rig } from "../rig";
import { ignoreCancelled, Run } from "./run";
import { hop, type Stage } from "./script";

// The hand-over plays while this share of the landing's height scrolls away.
const SPAN = 0.7;
// Past this point a playing intro ends where it would have, so the hand-over starts from the
// settled scene; past the next the bird leaves for the window, and under the last it comes home.
const CUT_AT = 0.2;
const LEAVE_AT = 0.3;
const RETURN_AT = 0.1;
// The query's three lines, and where it and the rows land when the window's app isn't up yet.
const LINES = 3;
const FALLBACK = { query: { x: 0.3, y: 0.14 }, rows: { x: 0.45, y: 0.55 } };
// The rows land this far inside the results pane, under its header.
const PANE_INSET = { x: 16, y: 40 };
// The caption under the stack.
const CAPTION = 24;
// The least the query keeps clear of the bottom of the view.
const EDGE = 8;

export type HandOverOptions = {
  stage: RefObject<HTMLElement | null>;
  target: TryWindow;
  bird: Bird | null;
  settled: boolean;
  cut: () => void;
  play: () => Stage | null;
};

/**
 * The scroll hand-over. The keys fold into their shadows first while the query and the rows hold
 * still on screen; then both glide down into the real window, onto the editor's own copy of the
 * query and its results pane, and fade there. The bird leaves for the window's top edge. Scroll
 * linked, never scroll-jacked.
 */
export function useHandOver(rig: Rig, { stage, target, bird, settled, cut, play }: HandOverOptions) {
  useEffect(() => {
    const section = stage.current;
    const query = rig.query.current;
    if (!section || !query) return;
    const run = new Run();
    // what this effect has moved the query by, so its own place can be read back
    const shift = { x: 0, y: 0 };
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const scrolled = Math.max(0, -rect.top);
      const p = clamp(scrolled / (rect.height * SPAN), 0, 1);
      if (p > CUT_AT) cut();
      const sculpture = rig.sculpture.current;
      sculpture?.setFold(p * 2.4);
      sculpture?.setOpacity(1 - smoothstep(0.3, 0.5, p));

      const win = target.frame.current?.getBoundingClientRect();
      if (win) {
        const glide = smoothstep(0.18, 0.86, p);
        const line = target.frame.current?.querySelector(".cm-line:nth-child(2)")?.getBoundingClientRect();
        const onLine = line !== undefined && line.height > 0;
        const q = query.getBoundingClientRect();
        const homeX = q.left - shift.x;
        const homeY = q.top - shift.y;
        // held where it stood before the page scrolled, until the glide takes it
        const heldY = homeY + scrolled;
        const toX = onLine ? line.left : win.left + win.width * FALLBACK.query.x;
        const scale = onLine ? Math.min(1, line.height / (query.offsetHeight / LINES)) : 0.4;
        // on a short screen the editor is still under the fold: the query waits at the foot of the
        // view for its line to come up to it
        const toY = Math.min(
          onLine ? line.top : win.top + win.height * FALLBACK.query.y,
          innerHeight - query.offsetHeight * scale - EDGE,
        );
        shift.x = (toX - homeX) * glide;
        shift.y = heldY + (toY - heldY) * glide - homeY;
        query.style.transform = `translate(${shift.x}px, ${shift.y}px) scale(${1 - (1 - scale) * glide})`;
        const shown = 1 - smoothstep(0.78, 1, p);
        query.style.opacity = String(shown);
        query.style.visibility = shown > 0.01 ? "" : "hidden";

        const layout = rig.layout.current;
        if (layout) {
          const pane = target.results.current?.getBoundingClientRect();
          const rowsX = pane ? pane.left + PANE_INSET.x : win.left + win.width * FALLBACK.rows.x;
          const rowsY = pane ? pane.top + PANE_INSET.y : win.top + win.height * FALLBACK.rows.y;
          const stackX = rect.left + layout.stack.x;
          const stackY = rect.top + layout.stack.y;
          const heldStack = stackY + scrolled;
          const drop = (rowsY - heldStack) * glide;
          // The pane is under the fold for most of the glide: the rows fade as they go down, and are
          // gone by the time the stack's foot would leave the view.
          const room = innerHeight - (heldStack + layout.stack.count * layout.stack.gap + CAPTION);
          const clear = 1 - clamp(drop / Math.max(1, room), 0, 1);
          rig.slips.current?.shift(
            (rowsX - stackX) * glide,
            heldStack + drop - stackY,
            Math.min(1 - smoothstep(0.7, 0.95, p), clear),
          );
        }
      }

      const perch = target.perch.current;
      if (!bird || !perch || !settled) return;
      if (p > LEAVE_AT && !rig.handedOver.current) {
        rig.handedOver.current = true;
        rig.sculpture.current?.setOccupied(null);
        void bird.perchOn(perch, { at: 0.86, facing: "left" });
      } else if (p < RETURN_AT && rig.handedOver.current) {
        rig.handedOver.current = false;
        const scene = play();
        if (scene) hop(scene, rig.home.current, { run, pace: 1.1 }).catch(ignoreCancelled);
      }
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      run.cancel();
    };
  }, [rig, stage, target, bird, settled, cut, play]);
}
