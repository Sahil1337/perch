import { clamp } from "../../shared/math";
import { EASE_IN_OUT_CSS, EASE_OUT_CSS } from "../../shared/motion";

/** A moment in a loop: `at` ms in, the element looks like `frame`, then eases towards the next. */
export type Beat = [at: number, frame: Keyframe];

/** A beat's easing for a part that travels from one place to another: a drag, a tuck. */
export const IN_OUT = EASE_IN_OUT_CSS;

/**
 * One element's part in a loop `period` ms long, repeating for as long as it runs. It holds its first
 * beat until that beat's time and its last beat to the end of the loop, so a part that only moves
 * once in a while needs only the beats around that move. Each beat eases out into the next unless it
 * names its own easing.
 */
export function track(el: Element, period: number, beats: Beat[], easing = EASE_OUT_CSS): Animation {
  const frames = beats.map(([at, frame]) => ({ easing, ...frame, offset: clamp(at / period, 0, 1) }));
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first && first.offset > 0) frames.unshift({ ...first, offset: 0 });
  if (last && last.offset < 1) frames.push({ ...last, offset: 1 });
  return el.animate(frames, { duration: period, iterations: Infinity, fill: "both" });
}

// A key's travel: quick down, held a moment, a softer return.
const DOWN_MS = 90;
const HOLD_MS = 140;
const UP_MS = 220;
const UP: Keyframe = { transform: "translateY(0)" };
const DOWN: Keyframe = { transform: "translateY(3px)" };
const SHADOW_UP: Keyframe = { transform: "scaleX(1)", opacity: 1 };
const SHADOW_DOWN: Keyframe = { transform: "scaleX(0.95)", opacity: 0.7 };

function strokes(times: number[], up: Keyframe, down: Keyframe): Beat[] {
  return [...times]
    .sort((a, b) => a - b)
    .flatMap((at): Beat[] => [
      [at, up],
      [at + DOWN_MS, down],
      [at + DOWN_MS + HOLD_MS, down],
      [at + DOWN_MS + HOLD_MS + UP_MS, up],
    ]);
}

/**
 * A Keycap going down at each of `times` (ms into the loop) and coming back up: its top face sinks
 * into the skirt and its contact shadow tightens, as a `pressed` key does.
 */
export function press(key: Element, period: number, times: number[]): Animation[] {
  const top = key.querySelector("[data-keycap-top]");
  const shadow = key.querySelector("[data-keycap-shadow]");
  const out: Animation[] = [];
  if (top) out.push(track(top, period, strokes(times, UP, DOWN)));
  if (shadow) out.push(track(shadow, period, strokes(times, SHADOW_UP, SHADOW_DOWN)));
  return out;
}
