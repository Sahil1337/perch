import { useEffect } from "react";
import { roam } from "../../shared/bird";
import { useBirdFor } from "./driver";
import { type RouteStep, zoneFor } from "./route";

/**
 * The bird's route down the page, from the try window to the footer: while the route drives, the
 * bird roams the section being read, one zone per step, and follows the reader as they scroll. The
 * landing brings it on stage and hands it over; a reload part-way down starts it where the reader is.
 */
export function useBirdRoute(steps: RouteStep[]): void {
  const bird = useBirdFor("route");
  useEffect(() => {
    if (!bird) return;
    const zones = steps.flatMap(({ ref, ...options }) => (ref.current ? [zoneFor({ el: ref.current, ...options })] : []));
    return roam(bird, { zones, ceiling: document.querySelector("[data-site-nav]") });
    // The steps are refs and constants: the route is set up each time it takes the bird.
  }, [bird]);
}
