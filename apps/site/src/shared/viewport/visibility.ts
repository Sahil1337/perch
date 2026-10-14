import { type RefObject, useEffect, useState } from "react";

type Target = RefObject<Element | null> | Element | null;

const resolve = (target: Target): Element | null => (target && "current" in target ? target.current : target);

/** Whether at least `share` of `target` is on screen, live: a scene plays only while it is. */
export function useVisible(target: Target, share = 0.4): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = resolve(target);
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!!entry && entry.isIntersecting && entry.intersectionRatio >= share),
      { threshold: [0, share] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [share, target]);
  return visible;
}

/** Turns true once `target` comes within `screens` view heights of the viewport, and stays true. */
export function useNear(target: Target, screens = 1): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = resolve(target);
    if (!element || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: `${screens * 100}% 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, screens, target]);
  return near;
}
