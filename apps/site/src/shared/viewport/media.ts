import { useCallback, useSyncExternalStore } from "react";

// Tailwind's md and lg breakpoints.
export const MD = "(min-width: 48rem)";
export const LG = "(min-width: 64rem)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether `query` matches, live, and read synchronously on the first render so nothing flashes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  );
}

/** prefers-reduced-motion, live. */
export const usePrefersReducedMotion = (): boolean => useMediaQuery(REDUCED_MOTION);
