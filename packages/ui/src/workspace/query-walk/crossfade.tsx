// One value turning into another in place: the old one leaves upward, the new one arrives from
// below, and nothing around it moves.
//
// The walk uses this wherever a label or a value changes under a heading that must not jump — a
// column header renamed by the station, the needle of a membership test as the scrubber moves, a
// literal spliced into the SQL block. `mode="popLayout"` takes the leaving copy out of flow so the
// two never stack and push their neighbours apart, and the wrapper is the grid they share.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useT } from "./walk-motion";

/**
 * How far the two copies travel, in pixels.
 *
 * One number for every crossfade in the walk. It was hand-copied per call site and had drifted to
 * 5 in two of them, which is a pixel nobody chose and nobody could see — the gesture is the fade,
 * and the travel is only there to give it a direction.
 */
const TRAVEL = 4;

export function Crossfade({
  value,
  className = "relative inline-grid",
  textClassName,
  title,
}: {
  /** The text shown, and its own key: a new value is a new element, which is what makes it fade. */
  readonly value: string;
  /** The wrapper, which owns the grid the two copies share. */
  readonly className?: string;
  readonly textClassName?: string;
  readonly title?: string;
}): React.ReactElement {
  const t = useT();
  return (
    <span className={className}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className={textClassName}
          exit={{ opacity: 0, y: -TRAVEL }}
          initial={{ opacity: 0, y: TRAVEL }}
          key={value}
          title={title}
          transition={t.fade}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
