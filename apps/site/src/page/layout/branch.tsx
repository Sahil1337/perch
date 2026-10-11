import { motion, useReducedMotion } from "motion/react";
import type { Ref } from "react";
import { EASE_OUT } from "../../shared/motion";

/**
 * The hairline every section opens on, run out to both edges of the viewport. It draws in from the
 * left the first time it comes into view. Its positioned parent must be centred on the page, which
 * every section and the hero's window are.
 */
export function Branch() {
  const reduced = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 z-10 h-px w-screen -translate-x-1/2">
      {reduced ? (
        <div className="h-px bg-foreground/20" />
      ) : (
        <motion.div
          className="h-px origin-left bg-foreground/20"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: EASE_OUT }}
        />
      )}
    </div>
  );
}

/**
 * Where the bird stands on a branch: an invisible line at the top of its parent, as wide as the
 * parent's content, so a step's `at` (0..1) is measured across the page's content rather than the
 * whole viewport. Pair it with a Branch at the same height.
 */
export function Perch({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return <div ref={ref} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" />;
}
