import { type Beat, track } from "../../materials";

// Beats are written against the still frame, the finished stack: a part with no offset is where
// the markup puts it.

const PERIOD = 8600;
/** FROM is the stack's first slip and stays put; each later clause lands on the one before. */
const FIRST_LAND_AT = 500;
const LAND_PITCH = 660;
const LAND_MS = 520;
/** The count starts ticking once the slip has nearly settled. */
const TICK_DELAY = 300;
const TICK_MS = 110;
/** The stack is cleared from the top down, newest slip first, each lifted off in turn. */
const CLEAR_AT = PERIOD - 1300;
const CLEAR_PITCH = 70;
const CLEAR_MS = 320;
const LIFT_PX = 6;
/** By now every slip has gone; the counts go back under their windows unseen. */
const CLEARED_AT = PERIOD - 300;
/** A landing slip comes down from a little above, turned a hair more, and settles. */
const DROP_PX = 14;
const SETTLE_DEG = 1.2;

function landBeats(at: number, turn: number, clearAt: number): Beat[] {
  const settled: Keyframe = { opacity: 1, transform: "translateY(0) rotate(0deg)" };
  return [
    [at, { opacity: 0, transform: `translateY(${-DROP_PX}px) rotate(${turn * SETTLE_DEG}deg)` }],
    [at + LAND_MS, settled],
    [clearAt, settled],
    [clearAt + CLEAR_MS, { opacity: 0, transform: `translateY(${-LIFT_PX}px) rotate(0deg)` }],
  ];
}

/**
 * A wheel of `n` figures rolling from its first figure to its last, a line a click: the column starts
 * lowered by all but one line, so the count before shows in the window, and rises a line at each
 * click until the markup's place, the last figure, shows. Once the slip has gone it is lowered again
 * unseen. One element moves per place, however many figures it passes.
 */
function wheelBeats(at: number, n: number): Beat[] {
  // `k` figures in: translateY's percentage is of the column's own height, `n` lines.
  const showing = (k: number): Keyframe => ({ transform: `translateY(${((n - 1 - k) / n) * 100}%)` });
  return [
    ...Array.from({ length: n }, (_, k): Beat => [at + k * TICK_MS, showing(k)]),
    [CLEARED_AT, showing(n - 1)],
    [CLEARED_AT, showing(0)],
  ];
}

/** The piece's loop: each clause lands on the stack in turn, its count ticking down, then the stack is cleared. */
export function walkLoop(root: HTMLElement): Animation[] {
  const out: Animation[] = [];
  const slips = root.querySelectorAll("[data-clause]");
  slips.forEach((slip, i) => {
    if (i === 0) return;
    const at = FIRST_LAND_AT + (i - 1) * LAND_PITCH;
    const clearAt = CLEAR_AT + (slips.length - 1 - i) * CLEAR_PITCH;
    out.push(track(slip, PERIOD, landBeats(at, i % 2 ? 1 : -1, clearAt)));
    for (const wheel of slip.querySelectorAll("[data-wheel]")) {
      const n = wheel.children.length;
      if (n > 1) out.push(track(wheel, PERIOD, wheelBeats(at + TICK_DELAY, n)));
    }
  });
  return out;
}
