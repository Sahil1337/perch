import { type RefObject, useEffect, useState } from "react";
import { useInView } from "../../../shared/motion";
import { usePrefersReducedMotion } from "../../../shared/viewport/media";

// However the landing goes, the window is not held back for longer than this.
const LOAD_ANYWAY_MS = 9000;

/**
 * Whether the window's app may mount. It is the heaviest module on the page, so it waits until the
 * landing's intro has settled, the visitor scrolls, or a few seconds have passed, which keeps its
 * parse out of the bird's flight. Under reduced motion it waits for the window to be in view
 * instead: there the demo jumps to its last frame and puts the caret in the editor, and the editor
 * would scroll the page to a caret still below the fold.
 */
export function useMountWindow(settled: boolean, frame: RefObject<HTMLElement | null>): boolean {
  const reduced = usePrefersReducedMotion();
  const seen = useInView(frame, { amount: 0.35 });
  const [early, setEarly] = useState(false);
  useEffect(() => {
    if (reduced || settled) return;
    const go = () => setEarly(true);
    const timer = window.setTimeout(go, LOAD_ANYWAY_MS);
    addEventListener("scroll", go, { once: true, passive: true });
    return () => {
      clearTimeout(timer);
      removeEventListener("scroll", go);
    };
  }, [reduced, settled]);
  return reduced ? seen : settled || early;
}
