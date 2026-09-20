// The two wrappers the first-run screen is built out of. Neither knows anything about onboarding:
// one is a height-and-fade, the other is a button that hands over to a copy of itself somewhere
// else on the screen.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useCollapse, useFade } from "../lib/motion";
import { Button } from "../ui/button";

/**
 * A ghost button on the column's edge, pulled out by its own padding so the *text* lands on the
 * line while the pressable area keeps its size. Only correct inside a `ROW_COLUMN` container.
 */
const EDGE_RIGHT = "-mr-2";

/**
 * "Skip for now", in whichever of its two homes is the bottom of the screen: the disclosure row
 * when the form is closed, the form's action row when it is open.
 *
 * It hands over rather than flies. The panel between the two homes is a height transition inside a
 * clipping box, so a travelling element would be measured against a moving target and clipped for
 * part of the trip. One leaves, the other arrives a beat later, and the beat reads as movement.
 */
export function Skip({
  show,
  onClick,
}: {
  show: boolean;
  onClick: () => void;
}): React.ReactElement {
  const fade = useFade();

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: fade }}
          initial={{ opacity: 0 }}
          transition={{ ...fade, delay: fade.duration }}
        >
          <Button className={EDGE_RIGHT} onClick={onClick} size="xs" variant="ghost">
            Skip for now
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Height-and-fade, for the parts of the screen the form stands in for. */
export function Collapse({ children }: { children: React.ReactNode }): React.ReactElement {
  const collapse = useCollapse();

  return (
    <motion.div
      animate={{ height: "auto", opacity: 1 }}
      className="w-full overflow-hidden"
      exit={{ height: 0, opacity: 0 }}
      initial={{ height: 0, opacity: 0 }}
      transition={collapse}
    >
      {children}
    </motion.div>
  );
}
