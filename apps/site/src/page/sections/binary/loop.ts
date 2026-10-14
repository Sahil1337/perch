import { type Beat, track } from "../../materials";

const PERIOD = 8000;

// A pendulum slows into each end of its swing and speeds through the middle; easing out alone would
// jerk it away from every end.
const SWING = "cubic-bezier(0.37, 0, 0.63, 1)";

const turn = (deg: number): Keyframe => ({ transform: `rotate(${deg}deg)` });

// A breath of air: the tag swings out, back a little less each time, and hangs still again.
const SWAY: Beat[] = [
  [1000, turn(0)],
  [1800, turn(3.5)],
  [2700, turn(-2.5)],
  [3600, turn(1.6)],
  [4500, turn(-0.9)],
  [5400, turn(0.4)],
  [6300, turn(0)],
];

/** The piece's loop: the tag sways on its knot now and then. */
export function binaryLoop(root: HTMLElement): Animation[] {
  const tag = root.querySelector("[data-tag]");
  return tag ? [track(tag, PERIOD, SWAY, SWING)] : [];
}
