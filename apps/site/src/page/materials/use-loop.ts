import { type RefObject, useEffect } from "react";
import { usePrefersReducedMotion } from "../../shared/viewport/media";

/** The share of a piece that must be in view before its loop starts. */
const START = 0.25;

/**
 * Plays a piece's loop while it is in view, and only then: `build` makes its animations once at
 * least a quarter of the piece shows, and every one is cancelled as soon as it has left the view, so
 * it comes back from the start. Under reduced motion nothing is built and the piece's own markup is
 * its still frame. `build` must be stable: define it outside the component.
 */
export function useLoop(ref: RefObject<HTMLElement | null>, build: (root: HTMLElement) => Animation[]): void {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    let running: Animation[] = [];
    const stop = () => {
      for (const animation of running) animation.cancel();
      running = [];
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= START) {
            if (!running.length) running = build(root);
          } else if (!entry.isIntersecting) stop();
        }
      },
      { threshold: [0, START] },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [ref, build, reduced]);
}
