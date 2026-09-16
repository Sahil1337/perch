"use client";

// The walk's motion, drawn from the workspace's one spring and one fade so the scene moves like
// the rest of the app. Every transition here is zeroed under prefers-reduced-motion.

import { useReducedMotion, type Transition } from "motion/react";
import { createContext, useContext } from "react";
import { COLLAPSE, FADE_EASE, FADE_S, INSTANT, SPRING } from "../../lib/motion";

const FADE: Transition = { duration: FADE_S, ease: FADE_EASE };
/** Width folds the same way height does: a tween, opacity ahead of the fold. */
const FOLD: Transition = {
  height: COLLAPSE.height,
  width: COLLAPSE.height,
  marginBottom: COLLAPSE.height,
  opacity: COLLAPSE.opacity,
};

export type WalkTransitions = {
  readonly spring: Transition;
  readonly fade: Transition;
  readonly collapse: Transition;
  /** The fold's height track on its own, for a block whose height follows swapped content. */
  readonly fold: Transition;
  readonly reduced: boolean;
};

export function useT(): WalkTransitions {
  const reduced = useReducedMotion() ?? false;
  return reduced
    ? { spring: INSTANT, fade: INSTANT, collapse: INSTANT, fold: INSTANT, reduced: true }
    : { spring: SPRING, fade: FADE, collapse: FOLD, fold: COLLAPSE.height, reduced: false };
}

/** A fold whose every track starts after `delay` seconds, for staggered exits. */
export function collapseAfter(t: WalkTransitions, delay: number): Transition {
  if (t.reduced) return INSTANT;
  const size = { ...COLLAPSE.height, delay };
  return { height: size, width: size, marginBottom: size, opacity: { ...COLLAPSE.opacity, delay } };
}

/** Playback speed multiplier (1 or 0.5); every schedule divides by it. */
export const SpeedContext = createContext(1);
export const useSpeed = (): number => useContext(SpeedContext);
