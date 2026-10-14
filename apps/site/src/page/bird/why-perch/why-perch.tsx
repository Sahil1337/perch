import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useLayoutEffect } from "react";
import { EASE_OUT } from "../../../shared/motion";
import { usePrefersReducedMotion } from "../../../shared/viewport/media";
import { Slip } from "../../materials";
import { WHY_PERCH } from "./copy";
import { type Anchor, placeSlip } from "./place";
import { useWhyPerch } from "./use-why-perch";

// Folds down from its top edge, as the completion section's slips do.
const FOLDED = { opacity: 0, rotateX: -84, transformPerspective: 480 };
const UNFOLDED = { opacity: 1, rotateX: 0, transformPerspective: 480 };

/**
 * Why the project is called perch, on a slip beside the bird: an easter egg for whoever rests the
 * pointer on it, or taps it, while it sits still. Nothing on the page points to it.
 */
export function WhyPerch({ settled }: { settled: boolean }) {
  const { anchor, slip } = useWhyPerch(settled);
  return <AnimatePresence>{anchor ? <WhyPerchSlip key="slip" anchor={anchor} slip={slip} /> : null}</AnimatePresence>;
}

function WhyPerchSlip({ anchor, slip }: { anchor: Anchor; slip: RefObject<HTMLDivElement | null> }) {
  const reduced = usePrefersReducedMotion();

  // Placed before it paints, from its own size; it stays put, as the bird does, until it closes.
  useLayoutEffect(() => {
    const el = slip.current;
    if (!el) return;
    const nav = document.querySelector("[data-site-nav]")?.getBoundingClientRect().bottom ?? 0;
    const { x, y } = placeSlip(anchor, el.offsetWidth, el.offsetHeight, Math.max(0, nav));
    el.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  }, [anchor, slip]);

  return (
    <motion.div
      ref={slip}
      id="why-perch"
      role="note"
      className="fixed top-0 left-0 z-40 w-64 origin-top sm:w-72"
      initial={FOLDED}
      animate={UNFOLDED}
      exit={FOLDED}
      transition={reduced ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT }}
    >
      <Slip tilt={-1} className="p-3 text-xs/5 lg:p-4 lg:text-sm/5">
        <p>
          <span className="font-semibold">{WHY_PERCH.word}</span>{" "}
          <span className="text-paper-muted">{WHY_PERCH.sound}</span>{" "}
          <span className="text-paper-muted italic">{WHY_PERCH.kind}</span>
        </p>
        <p className="mt-1">{WHY_PERCH.sense}</p>
        <p className="mt-3 text-paper-muted">{WHY_PERCH.idea}</p>
      </Slip>
    </motion.div>
  );
}
