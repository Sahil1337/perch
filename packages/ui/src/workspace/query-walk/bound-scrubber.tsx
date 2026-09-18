// The scrubber under a per-row section: one tick per outer row, the bound one raised.
//
// It is a slider rather than a strip of buttons because that is what it is — a single value being
// dragged across a range — and because a slider is the one control a screen reader already knows how
// to announce a position in. Grabbing it is what pauses playback: the reader taking hold of the
// timeline is unambiguous, so nothing has to be pressed twice.
//
// The ticks carry each row's verdict, which makes the scrubber a summary as well as a control: a bar
// of red with no green in it is the answer to "why did this query return nothing" before a single
// row has been bound.

import * as React from "react";
import { cn } from "../../lib/utils";
import type { BoundRow } from "./bound";

export function BoundScrubber({
  rows,
  current,
  label,
  onBind,
  onGrab,
}: {
  readonly rows: readonly BoundRow[];
  readonly current: number;
  /** What the bound row is, for the slider's spoken value. */
  readonly label: string;
  readonly onBind: (index: number) => void;
  /** Called the moment the reader takes hold, so auto-play can stop. */
  readonly onGrab: () => void;
}): React.ReactElement {
  const track = React.useRef<HTMLDivElement>(null);
  const last = rows.length - 1;

  const bindAt = React.useCallback(
    (clientX: number): void => {
      const box = track.current?.getBoundingClientRect();
      if (!box || box.width === 0 || rows.length === 0) return;
      const ratio = (clientX - box.left) / box.width;
      onBind(Math.min(last, Math.max(0, Math.floor(ratio * rows.length))));
    },
    [last, onBind, rows.length],
  );

  const grab = (event: React.PointerEvent<HTMLDivElement>): void => {
    onGrab();
    // Pointer capture, so a drag that leaves the track vertically — which is most drags — keeps
    // steering it instead of stopping the moment the pointer crosses the edge.
    event.currentTarget.setPointerCapture(event.pointerId);
    bindAt(event.clientX);
  };

  const drag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    bindAt(event.clientX);
  };

  const key = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? last : step === 0 ? null : current + step;
    if (target === null) return;
    event.preventDefault();
    onGrab();
    onBind(Math.min(last, Math.max(0, target)));
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div
        aria-label="Outer row"
        aria-valuemax={rows.length}
        aria-valuemin={1}
        aria-valuenow={current + 1}
        aria-valuetext={`Row ${current + 1} of ${rows.length}: ${label}`}
        className="flex h-8 w-full cursor-grab touch-none items-end gap-px rounded-md px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        onKeyDown={key}
        onPointerDown={grab}
        onPointerMove={drag}
        ref={track}
        role="slider"
        tabIndex={0}
      >
        {rows.map((row, index) => (
          <span
            aria-hidden
            className={cn(
              "min-w-0 flex-1 rounded-xs transition-all duration-200 motion-reduce:transition-none",
              index === current ? "h-7" : "h-3.5",
              row.pass ? "bg-success" : "bg-destructive",
              index === current ? "opacity-100" : "opacity-40",
            )}
            key={row.key}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        Row {current + 1} of {rows.length}. Drag to pick one; taking hold pauses playback.
      </p>
    </div>
  );
}
