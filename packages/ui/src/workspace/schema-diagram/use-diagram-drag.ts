"use client";

import * as React from "react";
import type { Point } from "./geometry";
import type { DiagramLayout } from "./use-diagram-layout";
import type { DiagramView } from "./use-diagram-view";

/** Pointer travel under which a press-and-release is a click, not a drag. */
const CLICK_SLOP = 3;

export type Drag =
  | { kind: "pan"; pointerId: number; origin: Point; pan: Point; moved: boolean }
  | { kind: "card"; pointerId: number; key: string; origin: Point; at: Point; moved: boolean };

export type DiagramDrag = {
  readonly drag: Drag | null;
  readonly onViewportPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onCardPointerDown: (event: React.PointerEvent<HTMLDivElement>, key: string) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
};

/** Pointer handling. The viewport pans; a card drags; a press without travel is a click. */
export function useDiagramDrag({
  layout,
  setSelected,
  view,
}: {
  layout: DiagramLayout;
  setSelected: React.Dispatch<React.SetStateAction<string | null>>;
  view: DiagramView;
}): DiagramDrag {
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const { canvasRef, flush, livePan, schedule, setView, viewportRef } = view;

  const onViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      kind: "pan",
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      pan: view.pan,
      moved: false,
    });
  };

  const onCardPointerDown = (event: React.PointerEvent<HTMLDivElement>, key: string): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const at = layout.positions.get(key);
    if (!at) return;
    viewportRef.current?.setPointerCapture(event.pointerId);
    setDrag({
      kind: "card",
      pointerId: event.pointerId,
      key,
      origin: { x: event.clientX, y: event.clientY },
      at,
      moved: false,
    });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.origin.x;
    const dy = event.clientY - drag.origin.y;
    const moved = drag.moved || Math.hypot(dx, dy) > CLICK_SLOP;
    if (!moved) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    if (drag.kind === "pan") {
      const pan = { x: drag.pan.x + dx, y: drag.pan.y + dy };
      livePan.current = pan;
      schedule(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.style.setProperty("--pan-x", `${pan.x}px`);
        canvas.style.setProperty("--pan-y", `${pan.y}px`);
      });
    } else {
      const next = { x: drag.at.x + dx / view.zoom, y: drag.at.y + dy / view.zoom };
      schedule(() => layout.moveCard(drag.key, next));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Whatever the last frame was going to do, do it now — a gesture that ends between frames
    // would otherwise drop its final millimetre of travel.
    flush();
    const panned = livePan.current;
    livePan.current = null;
    if (panned) setView((previous) => ({ ...previous, pan: panned }));
    if (!drag.moved) {
      // A click: on a card selects it (again to clear); on the canvas clears.
      setSelected((previous) => (drag.kind === "card" && previous !== drag.key ? drag.key : null));
    } else if (drag.kind === "card") {
      layout.savePositions();
    }
    setDrag(null);
  };

  return { drag, onCardPointerDown, onPointerMove, onPointerUp, onViewportPointerDown };
}
