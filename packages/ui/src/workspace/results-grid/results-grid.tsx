// The result grid, windowed from the start — a design constraint, not an optimisation, since
// retrofitting windowing onto a table is what breaks sticky headers. Two consequences:
//
//   Not a <table>. A windowed table body must be absolutely positioned, which destroys the layout
//   algorithm that made the markup worth having. This is an ARIA grid instead, so a screen reader
//   is told the true shape of the result even though only ~30 rows exist in the DOM.
//
//   Column widths are computed, not measured. The sizing lives in `grid-sizing.ts`, which explains
//   why.

import type { StatementResult } from "@perch/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { GridRow } from "./grid-row";
import { columnTemplate, OVERSCAN, ROW_HEIGHT } from "./grid-sizing";
import { useGridSelection } from "./use-grid-selection";

export function ResultsGrid({
  result,
  animateRows = false,
  className,
}: {
  result: StatementResult;
  /**
   * Fade the rows in, staggered, when the result lands. Off by default: a pane is a standing surface
   * you scroll, so arrival fades would fire every time the window refills. A notebook cell is the
   * opposite — the result arrives under the query that asked for it.
   */
  animateRows?: boolean;
  className?: string;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { columns, rows } = result;
  const template = React.useMemo(() => columnTemplate(columns, rows), [columns, rows]);

  // Fixed row height, so nothing is measured: the window is pure arithmetic over `rows.length`.
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: OVERSCAN,
  });

  const items = virtualizer.getVirtualItems();
  const offset = items[0]?.start ?? 0;

  const { selected, copied, select, copy, onFocus, onKeyDown } = useGridSelection({
    rows,
    columns,
    scrollRef,
    scrollToIndex: (index) => virtualizer.scrollToIndex(index),
  });

  // A first-paint flourish, not a scroll effect: only the window rendered on the frame the result
  // appeared animates, or the grid shimmers every time you drag it. The decision has to land on the
  // same frame as the rows it applies to, so it is computed here and stored on the way past — as
  // state rather than a ref, because state React throws away with a discarded render goes with it.
  const [stagger, setStagger] = React.useState<{
    result: StatementResult;
    ceiling: number;
  } | null>(null);
  const window_ =
    animateRows && stagger?.result !== result
      ? { result, ceiling: items.at(-1)?.index ?? -1 }
      : stagger;
  if (window_ !== stagger) setStagger(window_);
  const staggerCeiling = animateRows && !reduced ? (window_?.ceiling ?? -1) : -1;

  return (
    <div
      aria-colcount={columns.length}
      aria-label="Query results"
      aria-rowcount={rows.length + 1}
      className={cn("h-full w-full overflow-auto font-mono text-sm outline-none", className)}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      ref={scrollRef}
      role="grid"
      // One track list, computed from the data, so header and rows cannot drift apart.
      style={{ "--perch-grid-cols": template } as React.CSSProperties}
      tabIndex={selected ? -1 : 0}
    >
      <div className="w-max min-w-full">
        <div className="sticky top-0 z-10 bg-muted" role="rowgroup">
          <div aria-rowindex={1} className="grid grid-cols-(--perch-grid-cols)" role="row">
            {columns.map((column, index) => (
              <div
                aria-colindex={index + 1}
                className={cn(
                  "flex h-7 items-center gap-1.5 border-border border-r border-b px-2 last:border-r-0",
                  column.align === "right" && "justify-end",
                )}
                key={index}
                role="columnheader"
              >
                <span className="truncate font-medium text-foreground">{column.name}</span>
                <span className="shrink-0 font-sans text-muted-foreground text-xs">
                  {column.type}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="relative h-(--perch-grid-height)"
          role="rowgroup"
          style={
            { "--perch-grid-height": `${virtualizer.getTotalSize()}px` } as React.CSSProperties
          }
        >
          {/* One transform for the whole window: the rendered rows are always contiguous. */}
          <div
            className="absolute top-0 left-0 w-full translate-y-(--perch-grid-offset)"
            style={{ "--perch-grid-offset": `${offset}px` } as React.CSSProperties}
          >
            {items.map((item) => (
              <GridRow
                columns={columns}
                copied={copied}
                index={item.index}
                key={item.key}
                onCopy={copy}
                onSelect={select}
                reduced={reduced}
                row={rows[item.index] ?? []}
                selected={selected}
                staggered={item.index <= staggerCeiling}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
