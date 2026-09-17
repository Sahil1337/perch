"use client";

import * as React from "react";
import type { Point, Rect } from "./geometry";
import type { Node } from "./graph";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;
/** Padding kept around the graph when fitting it to the viewport. */
const FIT_PAD = 48;

type ViewState = { pan: Point; zoom: number };

export type DiagramView = {
  readonly viewportRef: React.RefObject<HTMLDivElement | null>;
  readonly canvasRef: React.RefObject<HTMLDivElement | null>;
  readonly pan: Point;
  readonly zoom: number;
  readonly setView: React.Dispatch<React.SetStateAction<ViewState>>;
  readonly livePan: React.RefObject<Point | null>;
  /** Runs the latest piece of work once, on the next frame. */
  readonly schedule: (work: () => void) => void;
  /** Runs whatever `schedule` is holding right now, if anything. */
  readonly flush: () => void;
  /** What the viewport shows, in canvas coordinates. */
  readonly visible: Rect;
  readonly fit: () => void;
  readonly zoomBy: (factor: number, about?: Point) => void;
};

/**
 * Where the canvas sits under the viewport: the pan and zoom, what that leaves on screen, and the
 * frame discipline the gestures that change it are held to.
 */
export function useDiagramView({
  bounds,
  focus,
  nodeByKey,
  nodeCount,
  positions,
}: {
  /** The box the graph occupies, which is what `fit` fits. */
  bounds: Rect;
  focus: string | undefined;
  nodeByKey: ReadonlyMap<string, Node>;
  nodeCount: number;
  positions: ReadonlyMap<string, Point>;
}): DiagramView {
  const [view, setView] = React.useState<ViewState>({ pan: { x: 0, y: 0 }, zoom: 1 });
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });

  /*
   * A pointer emits moves faster than the screen refreshes — a trackpad runs to 120Hz — and every
   * one of them used to be a React render of every card and every wire. Two things fix that.
   *
   * `schedule` coalesces: the LATEST piece of work runs, once, on the next frame. And a PAN never
   * reaches React at all while the gesture is live, because nothing about the picture depends on
   * where it is panned to except the transform itself, which is written straight to the node. The
   * final value is committed on release, which is when `visible` — and so which wires pulse — is
   * worth recomputing. A card drag still goes through state: the wires have to follow the card.
   */
  const frame = React.useRef<number | null>(null);
  const pending = React.useRef<(() => void) | null>(null);
  const schedule = React.useCallback((work: () => void): void => {
    pending.current = work;
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const run = pending.current;
      pending.current = null;
      run?.();
    });
  }, []);
  const flush = React.useCallback((): void => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);
  React.useEffect(() => flush, [flush]);

  /** Where the pan is right now, which during a gesture is ahead of `view.pan`. */
  const livePan = React.useRef<Point | null>(null);
  /** Wheel deltas banked since the last frame, so a trackpad flick is one render, not forty. */
  const wheelPan = React.useRef<Point>({ x: 0, y: 0 });

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = (): void => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  /** What the viewport shows, in canvas coordinates. A pulse on a wire outside it is not drawn. */
  const visible = React.useMemo<Rect>(
    () => ({
      x: -view.pan.x / view.zoom,
      y: -view.pan.y / view.zoom,
      w: viewportSize.width / view.zoom,
      h: viewportSize.height / view.zoom,
    }),
    [view, viewportSize],
  );

  const fit = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || bounds.w === 0) return;
    const { width, height } = viewport.getBoundingClientRect();
    const zoom = Math.max(
      ZOOM_MIN,
      Math.min(1, (width - FIT_PAD * 2) / bounds.w, (height - FIT_PAD * 2) / bounds.h),
    );
    setView({
      zoom,
      pan: {
        x: (width - bounds.w * zoom) / 2 - bounds.x * zoom,
        y: (height - bounds.h * zoom) / 2 - bounds.y * zoom,
      },
    });
  }, [bounds]);

  const centreOn = React.useCallback(
    (key: string) => {
      const viewport = viewportRef.current;
      const node = nodeByKey.get(key);
      const at = positions.get(key);
      if (!viewport || !node || !at) return;
      const { width, height } = viewport.getBoundingClientRect();
      setView({
        zoom: 1,
        pan: { x: width / 2 - (at.x + node.w / 2), y: height / 2 - (at.y + node.h / 2) },
      });
    },
    [nodeByKey, positions],
  );

  // First paint: the whole graph, or the table the view was opened for.
  const fitOnce = React.useRef(false);
  React.useLayoutEffect(() => {
    if (fitOnce.current || nodeCount === 0) return;
    fitOnce.current = true;
    if (focus && nodeByKey.has(focus)) centreOn(focus);
    else fit();
  }, [centreOn, fit, focus, nodeByKey, nodeCount]);

  const zoomBy = React.useCallback((factor: number, about?: Point) => {
    setView((previous) => {
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, previous.zoom * factor));
      const viewport = viewportRef.current?.getBoundingClientRect();
      const pivot = about ?? { x: (viewport?.width ?? 0) / 2, y: (viewport?.height ?? 0) / 2 };
      const scale = zoom / previous.zoom;
      return {
        zoom,
        pan: {
          x: pivot.x - (pivot.x - previous.pan.x) * scale,
          y: pivot.y - (pivot.y - previous.pan.y) * scale,
        },
      };
    });
  }, []);

  // A native listener, because React registers wheel as passive and the page must not scroll
  // while the pointer is over the canvas. Pinch (ctrl+wheel) zooms about the pointer; a plain
  // scroll pans, which is what a trackpad expects.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomBy(Math.exp(-event.deltaY * 0.01), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else {
        wheelPan.current.x -= event.deltaX;
        wheelPan.current.y -= event.deltaY;
        schedule(() => {
          const banked = wheelPan.current;
          wheelPan.current = { x: 0, y: 0 };
          setView((previous) => ({
            ...previous,
            pan: { x: previous.pan.x + banked.x, y: previous.pan.y + banked.y },
          }));
        });
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [schedule, zoomBy]);

  return {
    canvasRef,
    fit,
    flush,
    livePan,
    pan: view.pan,
    schedule,
    setView,
    viewportRef,
    visible,
    zoom: view.zoom,
    zoomBy,
  };
}
