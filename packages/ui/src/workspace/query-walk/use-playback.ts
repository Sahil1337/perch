// The player's three clocks: the one that starts it, the one that moves it, and the keys that
// override both.
//
// They are hooks rather than three effects in the middle of a component because none of them is
// about what is on screen, and each one holds a rule that is easy to get wrong by a frame.

import * as React from "react";
import type { Pos } from "./walk-cursor";

/**
 * Whether the focused control wants the arrow keys for itself.
 *
 * The walk binds them on `window` in the capture phase, which is what lets them step the scene from
 * wherever focus happens to sit — and which also means a control that steers with arrows cannot get
 * them back by stopping propagation. A text field never wanted them; neither does the bound
 * section's scrubber, which is a slider and moves by one row per press.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

function ownsArrowKeys(target: EventTarget | null): boolean {
  if (isTypingTarget(target)) return true;
  const element = target as HTMLElement | null;
  return (
    element !== null &&
    typeof element.closest === "function" &&
    element.closest('[role="slider"]') !== null
  );
}

/**
 * Auto-play a beat after there is something to show, unless the reader took the controls first.
 *
 * A program whose first chapter cannot run counts as settled straight away: its placeholder is
 * already on screen and waiting for a probe that will never be sent would strand playback.
 */
export function useAutoPlay(settled: boolean, touched: React.RefObject<boolean>, start: () => void): void {
  React.useEffect(() => {
    if (!settled) return;
    const id = setTimeout(() => {
      if (!touched.current) start();
    }, 1000);
    return () => clearTimeout(id);
  }, [settled, start, touched]);
}

/**
 * One beat, then the next position.
 *
 * The schedule only runs while playing, and only once the station's data is there: a station still
 * loading holds the player until its results land, then this effect re-runs. A per-row section
 * keeps its own time — one beat per outer row — and calls `advance` when it has shown the last one,
 * so it is skipped here; its chapter would otherwise end after a single hold.
 */
export function useBeat(args: {
  readonly playing: boolean;
  readonly settled: boolean;
  readonly perRow: boolean;
  readonly next: Pos | null;
  readonly delayMs: number;
  readonly onMove: (to: Pos) => void;
  readonly onEnd: () => void;
}): void {
  const { playing, settled, perRow, next, delayMs, onMove, onEnd } = args;
  React.useEffect(() => {
    if (!playing || !settled) return;
    if (perRow) return;
    if (next === null) {
      onEnd();
      return;
    }
    const id = setTimeout(() => onMove(next), delayMs);
    return () => clearTimeout(id);
  }, [delayMs, next, onEnd, onMove, perRow, playing, settled]);
}

/**
 * Space, left and right, bound for as long as the walk is mounted.
 *
 * Which is only while the dialog is open. The dialog is modal, so the editor never sees these;
 * typing targets inside it still keep their keys. Capture phase, because a focused control inside
 * the dialog (a rail dot after a click) stops arrow keys from bubbling, and the arrows must step
 * the walk wherever focus happens to sit.
 */
export function useWalkKeys(args: {
  readonly togglePlay: () => void;
  readonly stepForward: () => void;
  readonly stepBack: () => void;
}): void {
  const { togglePlay, stepForward, stepBack } = args;
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        togglePlay();
      } else if (ownsArrowKeys(event.target)) {
        return;
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepForward();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepBack();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [togglePlay, stepForward, stepBack]);
}
