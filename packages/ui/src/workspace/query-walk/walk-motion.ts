// The walk's motion. It borrows the workspace's CURVES so the scene still moves like the rest of
// the app, but deliberately not its durations. Every transition here is zeroed under
// prefers-reduced-motion.
//
// Why the walk is slower than the app it sits in: the rest of the workspace is OPERATED, and there
// a fast transition is a courtesy — nobody studies the results sheet sliding, they wait for it. The
// walk is WATCHED. Its animation is the explanation, not the packaging: a row arriving, a value
// being tested, a column folding away are each a claim about what the database did, and a claim
// that resolves in 220ms has been asserted rather than shown. So the gestures below run roughly
// half again as long as the app's, and `narration.ts` takes the time back out of the PAUSES rather
// than by hurrying them.

import { useReducedMotion, type Transition } from "motion/react";
import { createContext, useContext } from "react";
import { COLLAPSE, FADE_EASE, INSTANT } from "../../lib/motion";

/**
 * Long enough to read as one thing turning into another rather than as a cut.
 *
 * The app's 0.22 is the floor at which a crossfade resolves at all; this is the length at which a
 * reader can watch the old value leave and the new one arrive and see that they are two values.
 */
const WALK_FADE_S = 0.38;

/**
 * The walk's spring: the workspace's, slackened.
 *
 * Same shape, longer travel — stiffness down from 320 so a row takes a beat to cross the card
 * instead of snapping to its new place. The damping ratio (27/2√190 ≈ 0.98) is deliberately just
 * under 1: enough to kill overshoot, because a wobble on a row that has just been kept or dropped
 * reads as uncertainty about the verdict, and there is none.
 */
const WALK_SPRING: Transition = { type: "spring", stiffness: 190, damping: 27 };

/** The fold, lengthened to match. Opacity still finishes well ahead of the height, so what is
 *  leaving is gone before the space closes over it. */
const WALK_COLLAPSE = {
  height: { duration: 0.46, ease: COLLAPSE.height.ease },
  opacity: { duration: 0.22, ease: COLLAPSE.opacity.ease },
} as const;

const FADE: Transition = { duration: WALK_FADE_S, ease: FADE_EASE };
/** Width folds the same way height does: a tween, opacity ahead of the fold. */
const FOLD: Transition = {
  height: WALK_COLLAPSE.height,
  width: WALK_COLLAPSE.height,
  marginBottom: WALK_COLLAPSE.height,
  opacity: WALK_COLLAPSE.opacity,
};

type WalkTransitions = {
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
    : {
        spring: WALK_SPRING,
        fade: FADE,
        collapse: FOLD,
        fold: WALK_COLLAPSE.height,
        reduced: false,
      };
}

/** A fold whose every track starts after `delay` seconds, for staggered exits. */
export function collapseAfter(t: WalkTransitions, delay: number): Transition {
  if (t.reduced) return INSTANT;
  const size = { ...WALK_COLLAPSE.height, delay };
  return {
    height: size,
    width: size,
    marginBottom: size,
    opacity: { ...WALK_COLLAPSE.opacity, delay },
  };
}

/**
 * The longest a staggered gesture may take to get started, whatever it is staggering.
 *
 * Every phase in `narration.ts` is between 700ms and 1.7s. A stagger that runs past its own phase is
 * not a stagger: the scene changes on top of items that have not begun to move, motion interrupts
 * them mid-flight, and what the reader sees is a stutter rather than a gesture.
 *
 * This is the arithmetic that bounds it, and it is why the number is 0.55 rather than something
 * rounder. The shortest phase is 700ms, played at `BEAT` 1.45, so the beat is 1015ms. The last item
 * to move starts at the end of this window and then takes a fade to arrive: 0.55 + 0.38 = 0.93s,
 * which leaves 85ms of margin. Lengthen the fade or this window without redoing that sum and the
 * shortest phases start cutting off their own last row.
 */
const STAGGER_WINDOW_S = 0.55;

/**
 * When the `index`-th of `count` items moving together should start, in seconds.
 *
 * A flat per-item delay reads well on five rows and falls apart on twenty-five: at 75ms each, the
 * last row of a full sample would wait 1.8s to start, and the phase it belongs to is 900ms long.
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
