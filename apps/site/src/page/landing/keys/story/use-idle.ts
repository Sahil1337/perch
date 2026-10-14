import { useEffect, useRef } from "react";
import { type Bird, isHeld } from "../../../../shared/bird";
import { keyFromEvent, neighbours } from "../keymap";
import type { Rig } from "../rig";
import { ignoreCancelled, Run } from "./run";
import { hop, type Stage } from "./script";

// The bird's own hops come this far apart, and wait this long after the visitor's last key.
const IDLE_MS = { min: 8000, spread: 6000 };
const QUIET_MS = 5000;

// Keys belong to whatever has focus: a field, a link, a button.
function busy(node: Element | null): boolean {
  return (
    node !== null &&
    node !== document.body &&
    node !== document.documentElement &&
    node.closest("input, textarea, select, button, a, [contenteditable], [tabindex], [role=textbox]") !== null
  );
}

export type IdleOptions = {
  /** Settled and on screen. */
  enabled: boolean;
  bird: Bird | null;
  play: () => Stage | null;
};

/**
 * Once the intro is over: the visitor's own presses of the sculpture's keys send the bird to that
 * key, and now and then it hops to a neighbouring one by itself. Nothing is prevented, and nothing
 * reacts while something focusable has focus.
 */
export function useIdle(rig: Rig, { enabled, bird, play }: IdleOptions) {
  const lastVisitor = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const run = new Run();
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || rig.handedOver.current) return;
      if (busy(event.target instanceof Element ? event.target : null) || busy(document.activeElement)) return;
      const id = keyFromEvent(event.key);
      const scene = play();
      if (!id || !scene) return;
      lastVisitor.current = performance.now();
      if (bird && !bird.reducedMotion) rig.home.current = id;
      hop(scene, id, { run, pace: 1.6 }).catch(ignoreCancelled);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      run.cancel();
    };
  }, [enabled, bird, rig, play]);

  useEffect(() => {
    if (!enabled || !bird || bird.reducedMotion) return;
    const run = new Run();
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(tick, IDLE_MS.min + Math.random() * IDLE_MS.spread);
    };
    const tick = () => {
      const scene = play();
      if (scene && !rig.handedOver.current && !isHeld(bird) && performance.now() - lastVisitor.current > QUIET_MS) {
        const options = neighbours(rig.home.current);
        const id = options[Math.floor(Math.random() * options.length)];
        if (id) {
          rig.home.current = id;
          hop(scene, id, { run, pace: 1.1, force: 0.45, look: 300 }).catch(ignoreCancelled);
        }
      }
      next();
    };
    next();
    return () => {
      clearTimeout(timer);
      run.cancel();
    };
  }, [enabled, bird, rig, play]);
}
