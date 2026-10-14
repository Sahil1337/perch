import { useEffect, useRef } from "react";
import { linearstep } from "../../shared/math";
import { REDUCED_MOTION } from "../../shared/viewport/media";
import { onScrollFrame } from "../../shared/viewport/on-scroll-frame";

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
    const reduced = matchMedia(REDUCED_MOTION).matches;
    const element = sky.current;
    if (!element || reduced || CSS.supports?.("animation-timeline: scroll()")) return;
    const root = document.documentElement;
    const painted = [element, document.querySelector<HTMLElement>("[data-site-nav]")].filter((e) => e !== null);
    const update = () => {
      const max = root.scrollHeight - innerHeight;
      const progress = max > 0 ? scrollY / max : 0;
      const night = (linearstep(0.06, 0.45, progress) - 0.25 * linearstep(0.82, 1, progress)).toFixed(3);
      for (const target of painted) target.style.setProperty("--a-night", night);
      const download = document.getElementById("download");
      if (download) {
        // entry 0% .. cover 55%, as the CSS timeline has it
        const top = download.getBoundingClientRect().top;
        const dawn = linearstep(innerHeight, innerHeight - 0.55 * (innerHeight + download.offsetHeight), top);
        element.style.setProperty("--a-dawn", dawn.toFixed(3));
      }
    };
    const scroll = onScrollFrame(update);
    return () => {
      scroll.stop();
      for (const target of painted) target.style.removeProperty("--a-night");
      element.style.removeProperty("--a-dawn");
    };
  }, []);

  return <div ref={sky} data-site-sky aria-hidden />;
}
