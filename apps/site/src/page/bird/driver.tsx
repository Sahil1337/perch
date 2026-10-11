import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type Bird, useBird } from "../../shared/bird";
import { useTryWindow } from "../sections/try/window";

/** Who flies the page's one bird: the landing, through its intro and idle, or the page's roaming route. */
export type BirdDriver = "landing" | "route";

const DriverContext = createContext<BirdDriver>("landing");

// The height, as a share of the view, at which roam reads a section as the one being read.
const READING_LINE = 0.62;

/**
 * The one place that decides who drives the bird. The landing has it until the try window's top
 * edge comes up past the reading line, and the route from there on down; scrolling back above
 * that line gives it back to the landing. Each side only ever sees the bird while it drives, so
 * the two can never fly it at once.
 */
export function BirdDriverProvider({ children }: { children: ReactNode }) {
  const { perch } = useTryWindow().target;
  const [driver, setDriver] = useState<BirdDriver>("landing");
  useEffect(() => {
    const edge = perch.current;
    if (!edge) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.rootBounds) return;
        setDriver(entry.boundingClientRect.top <= entry.rootBounds.bottom ? "route" : "landing");
      },
      { rootMargin: `0px 0px -${Math.round((1 - READING_LINE) * 100)}% 0px` },
    );
    observer.observe(edge);
    return () => observer.disconnect();
  }, [perch]);
  return <DriverContext value={driver}>{children}</DriverContext>;
}

/** The bird while `driver` has it: null otherwise, and before the bird has loaded. */
export function useBirdFor(driver: BirdDriver): Bird | null {
  const bird = useBird();
  return useContext(DriverContext) === driver ? bird : null;
}
