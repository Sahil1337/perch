// One spring, one fade, one place. Motion that differs per component reads as jitter rather than
// as character, so every animated surface in the workspace pulls its timing from here.

import { useReducedMotion } from "motion/react";

/**
 * The workspace spring: quick enough that it never delays a click, damped enough that nothing
 * overshoots into wobble. Tuned on the results sheet, where the travel is longest. The damping
 * ratio (~0.84) leaves the eye something to follow; much stiffer and things arrive already there.
 */
export const SPRING = { type: "spring", stiffness: 320, damping: 30 } as const;

/**
 * Crossfade duration for content swapping in place (a label, a status, an icon). Under roughly
 * 0.15 a crossfade is too short to resolve and registers as a cut, which is what it exists to avoid.
 */
export const FADE_S = 0.22;

/**
 * The curve every fade uses. Eased at both ends because most of these fades move something as well
 * as fading it, and a linear ramp on a short travel reads as a mechanical slide. Symmetric, because
 * a crossfade's two halves are the same event seen twice.
 */
export const FADE_EASE = [0.4, 0, 0.2, 1] as const;

/**
 * Folding a block out of the layout, or back into it: height and opacity, fade ahead of the fold.
 *
 * A tween, not a spring: height is not a transform, so every frame is a re-layout, and a spring's
 * long settle is paid for in layout work. The opacity finishes in half the time, so what is leaving
 * is gone before the space closes over it.
 */
export const COLLAPSE = {
  height: { duration: 0.32, ease: [0.23, 1, 0.32, 1] },
  opacity: { duration: 0.16, ease: "easeOut" },
} as const;

/** What `prefers-reduced-motion` gets, everywhere. */
export const INSTANT = { duration: 0 } as const;

export function useSpring(): typeof SPRING | typeof INSTANT {
  return useReducedMotion() ? INSTANT : SPRING;
}

export function useCollapse(): typeof COLLAPSE | typeof INSTANT {
  return useReducedMotion() ? INSTANT : COLLAPSE;
}

export function useFade(): { duration: number; ease: typeof FADE_EASE } {
  return { duration: useReducedMotion() ? 0 : FADE_S, ease: FADE_EASE };
}
