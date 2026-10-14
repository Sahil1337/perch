import { useInView as useMotionInView } from "motion/react";
import type { RefObject } from "react";

export type InViewOptions = {
  /** Share of the element that must be visible: a number, "some" or "all". Default "some". */
  amount?: number | "some" | "all";
  /** Stays true after the first time. Default true. */
  once?: boolean;
  /** Grows or shrinks the viewport it is measured against, CSS margin syntax. */
  margin?: `${number}px` | `${number}px ${number}px` | `${number}px ${number}px ${number}px ${number}px`;
};

/** Whether the element is in view, from motion's observer. */
export function useInView(ref: RefObject<Element | null>, { amount = "some", once = true, margin }: InViewOptions = {}) {
  return useMotionInView(ref, { amount, once, margin });
}

