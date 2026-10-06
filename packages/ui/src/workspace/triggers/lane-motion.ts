// The lane's motion. The drawer and every arrival borrow the workspace's spring and fade from
// lib/motion.ts outright, because they are operated, not watched: nobody studies a drawer sliding.
// The pulse is the one gesture that is watched, so it is the one with a length of its own, set in
// `lane-tempo.ts` where the steps it has to fit inside are.
//
// Under prefers-reduced-motion everything here is the house INSTANT and the pulse is not drawn:
// the lit column and the card states already say where the statement is.

import { useReducedMotion, type Transition } from "motion/react";
import { COLLAPSE, FADE_EASE, INSTANT, useFade, useSpring } from "../../lib/motion";
import { PULSE_MS } from "./lane-tempo";

/**
 * A tween, not the spring: the pulse has to land inside a step whose length is fixed, and a
 * spring's settle has no fixed end. The fade's curve, because it is eased at both ends, and a pulse
 * that starts and stops at full speed reads as a jump.
 */
const PULSE: Transition = { duration: PULSE_MS / 1000, ease: FADE_EASE };

/**
 * The drawer leaving: a short tween on the fold's curve rather than the spring it came in on. A
 * dismissed drawer is not being watched, and the spring's long settle would leave it over the
 * lane, taking clicks meant for the cards under it, well after it looks gone.
 */
const DRAWER_EXIT: Transition = { duration: 0.2, ease: COLLAPSE.height.ease };

export type LaneMotion = {
  /** The drawer travelling in from the right edge. */
  readonly drawer: Transition;
  /** The drawer going back out, faster than it came in. */
  readonly drawerExit: Transition;
  /** A card, a log line or a row chip arriving. */
  readonly fade: Transition;
  /** The pulse travelling between columns, or null when it is not drawn at all. */
  readonly pulse: Transition | null;
  readonly reduced: boolean;
};

export function useLaneMotion(): LaneMotion {
  const reduced = useReducedMotion() ?? false;
  const drawer = useSpring();
  const fade = useFade();
  return {
    drawer,
    drawerExit: reduced ? INSTANT : DRAWER_EXIT,
    fade,
    pulse: reduced ? null : PULSE,
    reduced,
  };
}
