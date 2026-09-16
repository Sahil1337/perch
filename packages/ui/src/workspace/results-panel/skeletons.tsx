"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import { Skeleton } from "../../ui/skeleton";
import { ROW_HEIGHT } from "../results-grid";
import { barWidth } from "./format";

/**
 * Stand-in columns, in `ch`, weighted the way `columnTemplate` sizes real ones so the placeholder
 * stretches across a wide pane. The mix of widths is what makes it read as data rather than bars.
 */
const SKELETON_COLUMNS = [10, 22, 14, 9, 16, 12] as const;
const SKELETON_TEMPLATE = SKELETON_COLUMNS.map((ch) => `minmax(${ch}ch, ${ch}fr)`).join(" ");
/** Drawn before the pane has been measured, and the floor afterwards. */
const SKELETON_MIN_ROWS = 8;

/**
 * The wait, shaped like the answer: the grid's own geometry with the text swapped for bars, so the
 * result does not jump when it lands. The row count is measured rather than fixed, because the
 * panel is a notebook cell in one place and a full-height sheet in another.
 */
export function RunningRows(): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const [rows, setRows] = React.useState(SKELETON_MIN_ROWS);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (): void => {
      // The header takes a row off the top; the rest is what there is to fill. Ceil so a partial
      // row is drawn and clipped, the way a real result runs off the bottom edge.
      const body = element.clientHeight - ROW_HEIGHT;
      setRows(Math.max(SKELETON_MIN_ROWS, Math.ceil(body / ROW_HEIGHT)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-busy
      aria-label="Running"
      className="h-full w-full overflow-hidden font-mono text-sm"
      ref={ref}
      role="status"
      style={{ "--perch-grid-cols": SKELETON_TEMPLATE } as React.CSSProperties}
    >
      <div className="bg-muted">
        <div className="grid grid-cols-(--perch-grid-cols)">
          {SKELETON_COLUMNS.map((_, column) => (
            <div
              className="flex h-7 items-center gap-1.5 border-border border-r border-b px-2 last:border-r-0"
              key={column}
            >
              {/* Two bars, because the real header is a name and a type sitting beside it. */}
              <Skeleton
                className="h-2.5 w-(--perch-bar)"
                style={{ "--perch-bar": barWidth(0, column, 34, 26) } as React.CSSProperties}
              />
              <Skeleton className="h-2 w-5 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {Array.from({ length: rows }, (_, row) => (
        <div
          className={cn("grid grid-cols-(--perch-grid-cols)", row % 2 === 1 && "bg-muted/40")}
          key={row}
        >
          {SKELETON_COLUMNS.map((_, column) => (
            <div
              className="flex h-7 items-center border-border border-r border-b px-2 last:border-r-0"
              key={column}
            >
              <Skeleton
                className="h-2.5 w-(--perch-bar)"
                style={{ "--perch-bar": barWidth(row + 1, column, 46, 44) } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The wait, inline. Six loose rows rather than the pane's full fake grid: a cell is nine rows tall at
 * most, so a skeleton shaped like a complete table would overshoot and snap shut when the rows land.
 */
export function RunningBars(): React.ReactElement {
  return (
    <div aria-busy aria-label="Running" className="space-y-2 p-2.5" role="status">
      {Array.from({ length: 6 }, (_, row) => (
        <div className="grid grid-cols-3 gap-2" key={row}>
          {Array.from({ length: 3 }, (_, col) => (
            <Skeleton className="h-4" key={col} />
          ))}
        </div>
      ))}
    </div>
  );
}
