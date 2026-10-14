import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type Bird, useBird } from "../../shared/bird";
import { onScrollFrame } from "../../shared/viewport/on-scroll-frame";
import { useTryWindow } from "../hand-over/try-window";

/** Who flies the page's one bird: the landing, through its intro and idle, or the page's roaming route. */
export type BirdDriver = "landing" | "route";

const DriverContext = createContext<BirdDriver>("landing");
// The same answer, read when a callback runs rather than when its component renders.
const DriverNowContext = createContext<RefObject<BirdDriver>>({ current: "landing" });

// The height, as a share of the view, at which roam reads a section as the one being read.
const READING_LINE = 0.62;

/**
 * The one place that decides who drives the bird. The landing has it until the try window's top
 * edge comes up past the reading line, and the route from there on down; scrolling back above
 * that line gives it back to the landing. Each side only ever sees the bird while it drives, so
 * the two can never fly it at once.
 *
 * It reads the edge on each scroll rather than waiting for an IntersectionObserver: a jump (an
 * anchor under reduced motion, a reload part-way down) carries the edge from below the view to
 * above it without it ever intersecting, so an observer would never call back and the landing
 * would keep the bird, parked on the try window off the top of the view.
 */
export function BirdDriverProvider({ children }: { children: ReactNode }) {
  const { perch } = useTryWindow().target;
  const [driver, setDriver] = useState<BirdDriver>("landing");
  const now = useRef<BirdDriver>("landing");
  useEffect(() => {
    const edge = perch.current;
    if (!edge) return;
    return onScrollFrame(() => {
      now.current = edge.getBoundingClientRect().top <= innerHeight * READING_LINE ? "route" : "landing";
      setDriver(now.current);
    }).stop;
  }, [perch]);
  return (
    <DriverNowContext value={now}>
      <DriverContext value={driver}>{children}</DriverContext>
    </DriverNowContext>
  );
}

/** The bird while `driver` has it: null otherwise, and before the bird has loaded. */
export function useBirdFor(driver: BirdDriver): Bird | null {
  const bird = useBird();
  return useContext(DriverContext) === driver ? bird : null;
}

/**
 * The bird for a callback, if `driver` has it at the moment the callback runs. Unlike useBirdFor it
 * does not re-render its component when the bird changes hands, which happens mid-scroll, so the
 * page itself can hold one without redrawing every section each time.
 */
export function useBirdNow(driver: BirdDriver): () => Bird | null {
  const bird = useBird();
  const now = useContext(DriverNowContext);
  return useCallback(() => (now.current === driver ? bird : null), [bird, now, driver]);
}
