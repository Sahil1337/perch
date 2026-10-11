import * as React from "react";
import { cn } from "../../cn";
import "./window-frame.css";

export const TITLEBAR_HEIGHT = 40;

/** The app's native size inside the frame, chrome excluded: the scene is laid out at exactly this. */
export type FrameSize = { readonly width: number; readonly height: number };

export type FrameParts = {
  readonly outer: HTMLDivElement;
  readonly window: HTMLDivElement;
  readonly titlebar: HTMLDivElement;
  /** The app area under the titlebar, at native size. The camera moves what is inside it. */
  readonly app: HTMLDivElement;
};

/**
 * A browser window on 127.0.0.1:4600, the way the legacy scenes draw it. The window is laid out at
 * its native size and scaled to the container's width, so the app inside reads as a real desktop
 * window at any width; the container's aspect ratio is reserved from the first paint, so nothing
 * below moves when the app mounts into it.
 */
export function WindowFrame({
  size,
  className,
  label = "Perch, a SQL workspace, open in a browser",
  live = false,
  onParts,
  children,
}: {
  size: FrameSize;
  className?: string;
  label?: string;
  /**
   * The app takes the pointer and the keyboard. Until then it is inert, out of the tab order, and
   * the pointer passes through the whole window to the page: a wheel scrolls it, a hover changes
   * nothing, a press does nothing.
   */
  live?: boolean;
  onParts?: (parts: FrameParts) => void;
  children?: React.ReactNode;
}): React.ReactElement {
  const outer = React.useRef<HTMLDivElement>(null);
  const win = React.useRef<HTMLDivElement>(null);
  const titlebar = React.useRef<HTMLDivElement>(null);
  const app = React.useRef<HTMLDivElement>(null);

  // Before paint, so the first frame is already at the container's width.
  React.useLayoutEffect(() => {
    const element = outer.current;
    if (!element) return;
    const fit = (): void => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) element.style.setProperty("--frame-scale", String(width / size.width));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [size.width]);

  const reported = React.useRef(onParts);
  React.useLayoutEffect(() => {
    reported.current = onParts;
  });
  React.useLayoutEffect(() => {
    if (outer.current && win.current && titlebar.current && app.current) {
      reported.current?.({
        outer: outer.current,
        window: win.current,
        titlebar: titlebar.current,
        app: app.current,
      });
    }
  }, []);

  return (
    <div
      className={cn("relative w-full aspect-(--frame-aspect)", !live && "pointer-events-none", className)}
      data-perch-frame=""
      ref={outer}
      style={
        {
          "--frame-aspect": `${size.width} / ${size.height + TITLEBAR_HEIGHT}`,
          "--frame-w": `${size.width}px`,
          "--frame-h": `${size.height + TITLEBAR_HEIGHT}px`,
          "--frame-app-h": `${size.height}px`,
          "--frame-scale": "0",
        } as React.CSSProperties
      }
    >
      <div
        aria-label={label}
        className="dark absolute top-0 left-0 isolate h-(--frame-h) w-(--frame-w) origin-top-left scale-(--frame-scale) overflow-hidden rounded-lg bg-background text-foreground shadow-(--bui-shadow-overlay)"
        ref={win}
        role="group"
      >
        <div
          className="relative z-10 flex h-10 items-center justify-center border-border border-b bg-sidebar"
          ref={titlebar}
        >
          <div aria-hidden className="absolute inset-y-0 left-3.5 flex items-center gap-2">
            <span className="size-3 rounded-full bg-(--frame-close)" />
            <span className="size-3 rounded-full bg-(--frame-minimize)" />
            <span className="size-3 rounded-full bg-(--frame-zoom)" />
          </div>
          <div className="flex h-6 items-center rounded-sm bg-secondary px-3.5 font-sans text-(length:--frame-address-size) text-muted-foreground leading-none tabular-nums">
            127.0.0.1:4600
          </div>
        </div>
        <div
          className="absolute top-10 left-0 h-(--frame-app-h) w-(--frame-w) overflow-hidden bg-background font-sans text-foreground antialiased"
          data-perch-frame-app=""
          inert={!live}
          ref={app}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
