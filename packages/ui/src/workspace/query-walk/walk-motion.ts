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

/**
 * The longest a staggered gesture may take to get started, whatever it is staggering.
 *
 * Every phase in `narration.ts` is between 700ms and 1.7s. A stagger that runs past its own phase is
 * not a stagger: the scene changes on top of items that have not begun to move, motion interrupts
 * them mid-flight, and what the reader sees is a stutter rather than a gesture.
 */
const STAGGER_WINDOW_S = 0.45;

/**
 * When the `index`-th of `count` items moving together should start, in seconds.
 *
 * A flat per-item delay reads well on five rows and falls apart on twenty-five: at 45ms each, the
 * last row of a full sample would wait 1.08s to start, and the phase it belongs to is 900ms long.
 * Past `STAGGER_WINDOW_S` the stagger compresses to fit rather than running long, so the gesture
 * keeps its shape — first row first, last row last — at every sample size.
 */
export function staggerDelay(index: number, count: number, per: number): number {
  const spread = Math.max(1, count - 1);
  return spread * per <= STAGGER_WINDOW_S ? index * per : (index / spread) * STAGGER_WINDOW_S;
}

/** Playback speed multiplier (1 or 0.5); every schedule divides by it. */
export const SpeedContext = createContext(1);
export const useSpeed = (): number => useContext(SpeedContext);

/**
 * Whether the station on stage moves its rows rather than rebuilding them — a filter's survivors
 * sliding up, a sort re-ordering the card, a cut dropping the tail. Only then is a row on the new
 * card the same row as one on the old, and only then is there a move worth animating.
 *
 * A context for the same reason `GridPickContext` is one: a scene reaches the stage as DATA, and the
 * stage knows nothing about stations. Threading this down as a prop put a motion decision in the
 * signature of every component between the player and a table cell, four levels of them, none of
 * which had any business knowing what a station is.
 */
export const RowsMoveContext = createContext(false);
export const useRowsMove = (): boolean => useContext(RowsMoveContext);
