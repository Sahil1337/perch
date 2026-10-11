import { useEffect, useRef } from "react";

const ramp = (from: number, to: number, value: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));

/**
 * First light: the page's sky. page.css drives it from CSS scroll timelines; where those are
 * missing, this follows the scroll instead and sets the same two values, the night by how far down
 * the page, the dawn by how far the download section has come up. They are set on the sky and the
 * nav, the only elements that paint with them, never on the root, where a change would restyle the
 * whole page on every scroll frame.
 */
export function Sky() {
  const sky = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const element = sky.current;
    if (!element || reduced || CSS.supports?.("animation-timeline: scroll()")) return;
    const root = document.documentElement;
    const painted = [element, document.querySelector<HTMLElement>("[data-site-nav]")].filter((e) => e !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = root.scrollHeight - innerHeight;
      const progress = max > 0 ? scrollY / max : 0;
      const night = (ramp(0.06, 0.45, progress) - 0.25 * ramp(0.82, 1, progress)).toFixed(3);
      for (const target of painted) target.style.setProperty("--a-night", night);
      const download = document.getElementById("download");
      if (download) {
        // entry 0% .. cover 55%, as the CSS timeline has it
        const top = download.getBoundingClientRect().top;
        const dawn = ramp(innerHeight, innerHeight - 0.55 * (innerHeight + download.offsetHeight), top);
        element.style.setProperty("--a-dawn", dawn.toFixed(3));
      }
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      for (const target of painted) target.style.removeProperty("--a-night");
      element.style.removeProperty("--a-dawn");
    };
  }, []);

  return <div ref={sky} data-site-sky aria-hidden />;
}
