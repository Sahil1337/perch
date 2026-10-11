// The light half of what the real Relationship View and Query Walk scenes share: the window they
// are drawn in, and the guard that keeps the walk's keyboard off the page. Nothing here
// imports @perch/ui, so a page can load it with its first paint; the components themselves arrive
// later, from relations-walk-host.tsx and the scene modules that import it.

import * as React from "react";
import { cn } from "../../cn";
import { type FrameParts, WindowFrame } from "../../replay/stage/window-frame";
import "./relations-walk-kit.css";

export type SceneWindowParts = {
  readonly root: HTMLDivElement;
  readonly window: HTMLDivElement;
  readonly titlebar: HTMLDivElement;
  readonly app: HTMLDivElement;
};

/**
 * The real scenes' window (R1's `WindowFrame`: the legacy chrome over a `width` × `height` app
 * area, laid out at that size and scaled to the container's width, its box reserved from first
 * paint) with what these two scenes add: page content `below` it, a `held` state that stops the
 * CSS animations inside, and `children` rendered only once the window has its scale, because the
 * components inside measure themselves when they mount.
 */
export function SceneWindow({
  width,
  height,
  label,
  className,
  below,
  held = false,
  onParts,
  children,
}: {
  width: number;
  height: number;
  label: string;
  className?: string;
  /** Page content under the window, in the page's theme rather than the app's. */
  below?: React.ReactNode;
  /** Offscreen or paused: the CSS animations inside stop where they are. */
  held?: boolean;
  onParts?: (parts: SceneWindowParts) => void;
  children?: (parts: SceneWindowParts) => React.ReactNode;
}): React.ReactElement {
  const [parts, setParts] = React.useState<SceneWindowParts | null>(null);
  const reported = React.useRef(onParts);
  React.useLayoutEffect(() => {
    reported.current = onParts;
  });
  const size = React.useMemo(() => ({ width, height }), [width, height]);
  const onFrame = React.useCallback((frame: FrameParts) => {
    const next = { root: frame.outer, window: frame.window, titlebar: frame.titlebar, app: frame.app };
    setParts(next);
    reported.current?.(next);
  }, []);

  React.useEffect(() => {
    parts?.window.toggleAttribute("data-scene-held", held);
  }, [held, parts]);

  return (
    <div className={cn("relative w-full min-w-0", className)}>
      <WindowFrame label={label} onParts={onFrame} size={size}>
        {parts && children?.(parts)}
      </WindowFrame>
      {below}
    </div>
  );
}

/** Whether `ref` is at least `amount` visible, live: the scenes play only while they are. */
export function useVisible(ref: React.RefObject<Element | null>, amount = 0.4): boolean {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!!entry && entry.isIntersecting && entry.intersectionRatio >= amount),
      { threshold: [0, amount] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [amount, ref]);
  return visible;
}

/** Turns true once `ref` comes within about a screen of the viewport, and stays true. */
export function useNear(ref: React.RefObject<Element | null>): boolean {
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: "100% 0px 100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}

const walkWindows = new Set<Element>();
let keysGuarded = false;

/**
 * The Query Walk binds Space and the arrow keys on `window`, in the capture phase, for as long as
 * it is mounted — right for a modal dialog, wrong on a page, where Space scrolls. A press whose
 * target is outside every walk window is made to look like Alt+key to the walk's listener, the one
 * modifier it ignores, and is put back before the event goes any further than `window`.
 *
 * It has to be registered before the walk's own listener, which is why it is installed by the
 * light scene module rather than by the walk; listeners on one target run in the order they were
 * added. Returns the function that registers a walk window as a place where the keys are the walk's.
 */
export function guardWalkKeys(): (element: Element) => () => void {
  if (!keysGuarded && typeof window !== "undefined") {
    keysGuarded = true;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== " " && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const target = event.target instanceof Node ? event.target : null;
        for (const element of walkWindows) if (target && element.contains(target)) return;
        Object.defineProperty(event, "altKey", { configurable: true, value: true });
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (Object.hasOwn(event, "altKey")) Reflect.deleteProperty(event, "altKey");
      },
      true,
    );
  }
  return (element) => {
    walkWindows.add(element);
    return () => walkWindows.delete(element);
  };
}
