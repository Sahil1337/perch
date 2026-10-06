import { motion, type Transition } from "motion/react";
import type * as React from "react";

/**
 * The statement's position on the track. Rendered inside whichever column's node is current, with a
 * shared layout id, so moving it is a change of parent and motion carries it across: no column
 * offsets to measure, and nothing to recompute when the lane is resized.
 */
export function LanePulse({ transition }: { transition: Transition }): React.ReactElement {
  return (
    <motion.span
      aria-hidden
      className="absolute inset-0 z-10 m-auto size-2.5 rounded-full bg-info shadow-info/60 shadow-md"
      layoutId="triggers-lane-pulse"
      transition={transition}
    />
  );
}
