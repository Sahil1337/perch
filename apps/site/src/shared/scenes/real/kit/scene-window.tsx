// The light half of what the real Relationship View and Query Walk scenes share: the window they
// are drawn in. Nothing here imports @perch/ui, so a page can load it with its first paint; the
// components themselves arrive later, from dialog-host.tsx and the scene modules that import it.

import * as React from "react";
import { cn } from "../../../cn";
import { type FrameParts, WindowFrame } from "../../stage/window-frame";
import "./scene-window.css";

export type SceneWindowParts = {
  readonly root: HTMLDivElement;
  readonly window: HTMLDivElement;
  readonly titlebar: HTMLDivElement;
  readonly app: HTMLDivElement;
  /** The close-up's crop, when the window is one. */
  readonly lens?: HTMLDivElement;
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
  closeUp = false,
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
  /** The phone's close-up frame (see `WindowFrame`). */
  closeUp?: boolean;
  onParts?: (parts: SceneWindowParts) => void;
  children?: (parts: SceneWindowParts) => React.ReactNode;
}): React.ReactElement {
  const [reportedParts, setParts] = React.useState<SceneWindowParts | null>(null);
  // Parts from the other frame, for the one render before the new frame reports its own.
  const parts = reportedParts && (reportedParts.lens !== undefined) === closeUp ? reportedParts : null;
  const reported = React.useRef(onParts);
  React.useLayoutEffect(() => {
    reported.current = onParts;
  });
  const size = React.useMemo(() => ({ width, height }), [width, height]);
  const onFrame = React.useCallback((frame: FrameParts) => {
    const next = {
      root: frame.outer,
      window: frame.window,
      titlebar: frame.titlebar,
      app: frame.app,
      ...(frame.lens ? { lens: frame.lens } : {}),
    };
    setParts(next);
    reported.current?.(next);
  }, []);

  React.useEffect(() => {
    parts?.window.toggleAttribute("data-scene-held", held);
  }, [held, parts]);

  return (
    <div className={cn("relative w-full min-w-0", className)}>
      <WindowFrame
        closeUp={closeUp}
        key={closeUp ? "close-up" : "whole"}
        label={label}
        onParts={onFrame}
        size={size}
      >
        {parts && children?.(parts)}
      </WindowFrame>
      {below}
    </div>
  );
}
