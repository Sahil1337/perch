import * as React from "react";
import { cn } from "../../cn";
import "./window-frame.css";

export const TITLEBAR_HEIGHT = 40;

/**
 * Under lg the window is a close-up: a crop of the app at this scale or more, which keeps its 13px
 * text at 10px on a phone. The whole app at a phone's width is a third of that and unreadable.
 */
export const CLOSE_UP_SCALE = 0.78;
/** The close-up's box, reserved from the first paint: taller than the app, so a phone's column holds more of it. */
export const CLOSE_UP_ASPECT = "aspect-4/5 md:aspect-3/2";

/** The app's native size inside the frame, chrome excluded: the scene is laid out at exactly this. */
export type FrameSize = { readonly width: number; readonly height: number };

export type FrameParts = {
  readonly outer: HTMLDivElement;
  readonly window: HTMLDivElement;
  readonly titlebar: HTMLDivElement;
  /** The app area under the titlebar, at native size. The camera moves what is inside it. */
  readonly app: HTMLDivElement;
  /** The close-up's crop around the app: what a camera there frames. Absent in the whole window. */
  readonly lens?: HTMLDivElement;
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
  closeUp = false,
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
  /** The phone's close-up: the chrome at the page's size over a crop of the app, which a camera pans. */
  closeUp?: boolean;
  onParts?: (parts: FrameParts) => void;
  children?: React.ReactNode;
}): React.ReactElement {
  const outer = React.useRef<HTMLDivElement>(null);
  const win = React.useRef<HTMLDivElement>(null);
  const titlebar = React.useRef<HTMLDivElement>(null);
  const app = React.useRef<HTMLDivElement>(null);
  const lens = React.useRef<HTMLDivElement>(null);

  // Before paint, so the first frame is already at the container's width. A close-up never draws
  // the app narrower than its crop, so a tablet's wider column shows all of it across.
  React.useLayoutEffect(() => {
    const element = outer.current;
    if (!element) return;
    const fit = (): void => {
      const width = element.getBoundingClientRect().width;
      if (width <= 0) return;
      const scale = closeUp ? Math.max(CLOSE_UP_SCALE, (lens.current?.clientWidth ?? width) / size.width) : width / size.width;
      element.style.setProperty("--frame-scale", String(scale));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [size.width, closeUp]);

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
        ...(lens.current ? { lens: lens.current } : {}),
      });
    }
  }, []);

  const vars = {
    "--frame-aspect": `${size.width} / ${size.height + TITLEBAR_HEIGHT}`,
    "--frame-w": `${size.width}px`,
    "--frame-h": `${size.height + TITLEBAR_HEIGHT}px`,
    "--frame-app-h": `${size.height}px`,
    "--frame-scale": "0",
  } as React.CSSProperties;

  if (closeUp) {
    return (
      <div
        className={cn("relative w-full", CLOSE_UP_ASPECT, !live && "pointer-events-none", className)}
        data-perch-frame=""
        ref={outer}
        style={vars}
      >
        <div
          aria-label={label}
          className="dark absolute inset-0 isolate flex flex-col overflow-hidden rounded-lg bg-background text-foreground shadow-(--bui-shadow-overlay)"
          ref={win}
          role="group"
        >
          <div
            className="relative z-10 flex h-8 shrink-0 items-center justify-center border-border border-b bg-sidebar"
            ref={titlebar}
          >
            <div aria-hidden className="absolute inset-y-0 left-3 flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-(--frame-close)" />
              <span className="size-2.5 rounded-full bg-(--frame-minimize)" />
              <span className="size-2.5 rounded-full bg-(--frame-zoom)" />
            </div>
            <div className="flex h-5 items-center rounded-sm bg-secondary px-3 font-sans text-(length:--frame-address-size) text-muted-foreground leading-none tabular-nums">
              127.0.0.1:4600
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-background" ref={lens}>
            <div
              className="absolute top-0 left-0 h-(--frame-app-h) w-(--frame-w) origin-top-left scale-(--frame-scale) overflow-hidden bg-background font-sans text-foreground antialiased"
              data-perch-frame-app=""
              inert={!live}
              ref={app}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("relative w-full aspect-(--frame-aspect)", !live && "pointer-events-none", className)}
      data-perch-frame=""
      ref={outer}
      style={vars}
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
