import { type RefObject, useEffect, useState } from "react";
import type { Rig } from "../rig";

/**
 * Whether the landing is on screen with its tab showing. Nothing plays otherwise: the sculpture
 * stops drawing, and `onHide` gets the chance to end what was playing.
 */
export function useLive(rig: Rig, stage: RefObject<HTMLElement | null>, onHide: () => void): boolean {
  const [live, setLive] = useState(true);
  useEffect(() => {
    const section = stage.current;
    if (!section) return;
    let inView = true;
    const apply = () => {
      const next = inView && !document.hidden;
      rig.live.current = next;
      rig.sculpture.current?.setLive(next);
      setLive(next);
      if (!next) onHide();
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      apply();
    });
    observer.observe(section);
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, [rig, stage, onHide]);
  return live;
}
