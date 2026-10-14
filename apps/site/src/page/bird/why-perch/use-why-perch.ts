import { type RefObject, useEffect, useRef, useState } from "react";
import { holdBird, isHeld, useBird } from "../../../shared/bird";
import { type Anchor, inBirdBox } from "./place";

// A pointer resting this long on a bird with nothing else to do opens the slip; leaving both for
// LEAVE_MS closes it. A scroll in the last QUIET_MS means the reader is moving, not resting.
const DWELL_MS = 350;
const LEAVE_MS = 400;
const QUIET_MS = 250;
const SCROLL_PX = 4;

export type WhyPerchState = {
  /** Where the bird stood when the slip opened; null while it is closed. */
  anchor: Anchor | null;
  slip: RefObject<HTMLDivElement | null>;
};

/**
 * The easter egg's trigger. The bird's overlay never takes the pointer, so this hit-tests the
 * bird's own box against the pointer, and only once the pointer is within a couple of bird lengths
 * of it. A mouse resting on a perched, idle bird opens the slip, as does a tap on it; the bird turns
 * to the pointer, hops, and is held on its branch until the slip closes.
 */
export function useWhyPerch(settled: boolean): WhyPerchState {
  const bird = useBird();
  const slip = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    if (!bird || !settled) return;
    let frame = 0;
    let dwell = 0;
    let leave = 0;
    let watch = 0;
    let px = 0;
    let py = 0;
    let armedX = 0;
    let armedY = 0;
    let touch = false;
    let pressed = false;
    let pointing = false;
    let scrolledAt = -Infinity;
    let openAt: number | null = null;
    let release: (() => void) | null = null;
    const root = document.documentElement;

    // Perched, not held by anything else, the page at rest and no button down. A flight (the
    // intro, the hand-over, a hop to another key) reads as `flying`; a hop in place moves no feet.
    const idle = () => !bird.flying && !isHeld(bird) && !pressed && performance.now() - scrolledAt > QUIET_MS;

    const overBird = (p = bird.position) => p !== null && inBirdBox(p.x, p.y, bird.size, px, py);

    const overSlip = () => {
      const r = slip.current?.getBoundingClientRect();
      return r !== undefined && px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
    };

    const point = (on: boolean) => {
      if (on === pointing) return;
      pointing = on;
      root.style.cursor = on ? "pointer" : "";
    };

    const disarm = () => {
      point(false);
      clearTimeout(dwell);
      dwell = 0;
    };

    const close = () => {
      if (openAt === null) return;
      openAt = null;
      clearTimeout(leave);
      clearInterval(watch);
      leave = 0;
      point(false);
      release?.();
      release = null;
      setAnchor(null);
    };

    const open = () => {
      const p = bird.position;
      if (!p) return;
      disarm();
      openAt = scrollY;
      release = holdBird(bird);
      bird.lookAt({ x: px, y: py });
      bird.hop();
      // The page may still send it off (a key pressed on the landing): the slip goes with it.
      watch = window.setInterval(() => {
        if (bird.flying) close();
      }, 200);
      setAnchor({ x: p.x, y: p.y, size: bird.size });
    };

    const fire = () => {
      dwell = 0;
      const p = bird.position;
      if (p && Math.abs(p.x - armedX) < 1 && Math.abs(p.y - armedY) < 1 && overBird(p) && idle()) open();
      else point(false);
    };

    const update = () => {
      frame = 0;
      if (openAt !== null) {
        if (touch) return;
        if (overBird() || overSlip()) {
          clearTimeout(leave);
          leave = 0;
        } else leave ||= window.setTimeout(close, LEAVE_MS);
        return;
      }
      const p = bird.position;
      const reach = bird.size * 2;
      if (!p || Math.abs(px - p.x) > reach || Math.abs(py - p.y) > reach) return disarm();
      if (!overBird(p) || !idle()) return disarm();
      point(true);
      if (dwell) return;
      armedX = p.x;
      armedY = p.y;
      dwell = window.setTimeout(fire, DWELL_MS);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      px = event.clientX;
      py = event.clientY;
      touch = false;
      pressed = event.buttons !== 0;
      frame ||= requestAnimationFrame(update);
    };

    // Never prevented: the tap still reaches the editor or link under the bird.
    const onDown = (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
      touch = event.pointerType !== "mouse";
      if (openAt !== null) {
        if (!overBird() && !overSlip()) close();
        return;
      }
      if (!touch) {
        pressed = true;
        return disarm();
      }
      if (bird.position && overBird() && idle()) open();
    };

    const onUp = () => {
      pressed = false;
    };

    const onScroll = () => {
      scrolledAt = performance.now();
      if (openAt === null) disarm();
      else if (Math.abs(scrollY - openAt) > SCROLL_PX) close();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown, { passive: true });
    addEventListener("pointerup", onUp, { passive: true });
    addEventListener("pointercancel", onUp, { passive: true });
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", close);
    // Captured: the workspaces in the scenes below take Escape for themselves on the way up.
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", close);
      removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
      disarm();
      close();
    };
  }, [bird, settled]);

  return { anchor, slip };
}
