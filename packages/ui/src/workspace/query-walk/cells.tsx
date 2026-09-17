"use client";

// How every table in the walk sizes a column.
//
// A column's measured width reaches CSS as the custom property `--w`, so the layout itself stays in
// utility classes: the stage's cards pin a column to it, and the grid card uses it as a FLOOR that
// shares the card's slack. Both spellings live here so the cast that carries the property is
// written once rather than in every cell of every card.

import type * as React from "react";
import { cn } from "../../lib/utils";

export function CellFrame({
  children,
  className,
  grow = false,
  title,
  width,
}: {
  readonly children?: React.ReactNode;
  readonly className?: string;
  /**
   * Share the card's slack rather than taking exactly `width`.
   *
   * The grid card is as wide as the widest thing in it, which is regularly the legend above rather
   * than the table, and columns that only ever measured themselves left the difference as dead
   * space down the right of every row. There `--w` is a basis and the columns grow past it. On the
   * stage the slack falls OUTSIDE the columns instead — see `HeaderCell` in `stage.tsx` — because a
   * lone right-aligned digit stretched to the card's edge reads as further from its label than it
   * is.
   */
  readonly grow?: boolean;
  readonly title?: string;
  readonly width: number;
}): React.ReactElement {
  return (
    <div
      className={cn("shrink-0", grow ? "grow basis-(--w)" : "w-(--w)", className)}
      style={{ "--w": `${width}px` } as React.CSSProperties}
      title={title}
    >
      {children}
    </div>
  );
}
