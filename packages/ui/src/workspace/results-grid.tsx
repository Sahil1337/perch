"use client";

// The result grid, windowed from the start — a design constraint, not an optimisation, since
// retrofitting windowing onto a table is what breaks sticky headers. Two consequences:
//
//   Not a <table>. A windowed table body must be absolutely positioned, which destroys the layout
//   algorithm that made the markup worth having. This is an ARIA grid instead, so a screen reader
//   is told the true shape of the result even though only ~30 rows exist in the DOM.
//
//   Column widths are computed, not measured. With only visible rows in the DOM, browser
//   auto-sizing would re-fit on every scroll tick and jitter. The widths come from the content in
//   `ch`, over a sample of rows, identical for header and body because both are monospace.

import type { Cell, ResultColumn, StatementResult } from "@perch/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { FADE_EASE, FADE_S } from "../lib/motion";
import { cn } from "../lib/utils";

/** Fixed, and must stay in step with the `h-7` on a row. Virtualization needs one number. */
export const ROW_HEIGHT = 28;
const OVERSCAN = 12;

/** Column sizing bounds, in `ch`. A 48ch cap keeps one wide text column from eating the viewport. */
const MIN_WIDTH_CH = 6;
const MAX_WIDTH_CH = 48;
const PADDING_CH = 2;
/** Rows sampled when sizing. Reading all 1000 to size a column is not worth the frame. */
const WIDTH_SAMPLE = 200;

const COPIED_MS = 900;

/**
 * The cascade a result lands with. `delay` is capped at `ROW_STAGGER_MAX` so a 1000-row result does
 * not take twelve seconds to arrive: past that, every row shares the last delay and they land
 * together, which reads as "and the rest".
 */
const ROW_STAGGER_S = 0.012;
const ROW_STAGGER_MAX = 12;

type CellRef = { readonly row: number; readonly col: number };

/** A cell as text. `null` is not an empty string and renders muted and italic, never as a blank. */
export function formatCell(value: Cell): string {
  return value === null ? "null" : String(value);
}

/** `grid-template-columns`, sized from the data and stretched to fill. See the header for why. */
function columnTemplate(columns: readonly ResultColumn[], rows: readonly (readonly Cell[])[]): string {
  const sampled = Math.min(rows.length, WIDTH_SAMPLE);

  return columns
    .map((column, index) => {
      // The header shows "name type", so it sets a floor for the column.
      let widest = column.name.length + column.type.length + 1;
      for (let row = 0; row < sampled; row += 1) {
        const length = formatCell(rows[row]?.[index] ?? null).length;
        if (length > widest) widest = length;
      }
      const ch = Math.min(MAX_WIDTH_CH, Math.max(MIN_WIDTH_CH, widest + PADDING_CH));
      // The `ch` is a floor and the same number is the column's share of the surplus, so a wide
      // pane stretches columns in proportion instead of stranding a gap at the right edge.
      return `minmax(${ch}ch, ${ch}fr)`;
    })
    .join(" ");
}

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
  const [selected, setSelected] = React.useState<CellRef | null>(null);
  const [copied, setCopied] = React.useState<CellRef | null>(null);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when navigation moved the selection, so focus follows a row that may not be rendered yet.
  const chasingFocus = React.useRef(false);

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

  // A first-paint flourish, not a scroll effect: only the window rendered on the frame the result
  // appeared animates, or the grid shimmers every time you drag it. Compared in render, so the
  // decision lands on the same frame as the rows it applies to.
  const stagger = React.useRef<{ result: StatementResult; ceiling: number } | null>(null);
  if (animateRows && stagger.current?.result !== result) {
    stagger.current = { result, ceiling: items.at(-1)?.index ?? -1 };
  }
  const staggerCeiling = animateRows && !reduced ? (stagger.current?.ceiling ?? -1) : -1;

  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = React.useCallback((ref: CellRef, value: Cell): void => {
    void navigator.clipboard?.writeText(value === null ? "" : String(value));
    setCopied(ref);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
  }, []);

  // Scrolling a row into view only queues a render, so the target cell exists a tick later.
  React.useEffect(() => {
    if (!chasingFocus.current || !selected) return;
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-cell="${selected.row}:${selected.col}"]`,
    );
    if (!target) return;
    chasingFocus.current = false;
    target.focus();
  });

  const move = (from: CellRef, rowDelta: number, colDelta: number): void => {
    const row = clamp(from.row + rowDelta, 0, rows.length - 1);
    const col = clamp(from.col + colDelta, 0, columns.length - 1);
    if (row === from.row && col === from.col) return;
    setSelected({ row, col });
    chasingFocus.current = true;
    virtualizer.scrollToIndex(row);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0 || columns.length === 0) return;
    const from = selected ?? { row: 0, col: 0 };
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1);

    switch (event.key) {
      case "ArrowDown":
        move(from, 1, 0);
        break;
      case "ArrowUp":
        move(from, -1, 0);
        break;
      case "ArrowRight":
        move(from, 0, 1);
        break;
      case "ArrowLeft":
        move(from, 0, -1);
        break;
      case "PageDown":
        move(from, page, 0);
        break;
      case "PageUp":
        move(from, -page, 0);
        break;
      case "Home":
        move(from, event.ctrlKey || event.metaKey ? -rows.length : 0, -columns.length);
        break;
      case "End":
        move(from, event.ctrlKey || event.metaKey ? rows.length : 0, columns.length);
        break;
      case "Enter":
        if (selected) copy(selected, rows[selected.row]?.[selected.col] ?? null);
        break;
      case "c":
        if (!event.metaKey && !event.ctrlKey) return;
        if (selected) copy(selected, rows[selected.row]?.[selected.col] ?? null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      aria-colcount={columns.length}
      aria-label="Query results"
      aria-rowcount={rows.length + 1}
      className={cn("h-full w-full overflow-auto font-mono text-sm outline-none", className)}
      onFocus={(event) => {
        // Tabbing onto the grid parks on the first cell; focus inside it is left alone.
        if (event.target !== event.currentTarget) return;
        if (!selected && rows.length > 0 && columns.length > 0) {
          setSelected({ row: 0, col: 0 });
          chasingFocus.current = true;
        }
      }}
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
          style={{ "--perch-grid-height": `${virtualizer.getTotalSize()}px` } as React.CSSProperties}
        >
          {/* One transform for the whole window: the rendered rows are always contiguous. */}
          <div
            className="absolute top-0 left-0 w-full translate-y-(--perch-grid-offset)"
            style={{ "--perch-grid-offset": `${offset}px` } as React.CSSProperties}
          >
            {items.map((item) => {
              const row = rows[item.index] ?? [];
              const staggered = item.index <= staggerCeiling;

              return (
                <motion.div
                  animate={{ opacity: 1 }}
                  aria-rowindex={item.index + 2}
                  className={cn(
                    "grid grid-cols-(--perch-grid-cols) hover:bg-accent/40",
                    // Zebra by absolute index: a windowed row's DOM position changes as you
                    // scroll, so an nth-child stripe would crawl.
                    item.index % 2 === 1 && "bg-muted/40",
                  )}
                  initial={staggered ? { opacity: 0 } : false}
                  key={item.key}
                  role="row"
                  transition={{
                    duration: FADE_S,
                    delay: Math.min(item.index, ROW_STAGGER_MAX) * ROW_STAGGER_S,
                  }}
                >
                  {columns.map((column, col) => {
                    const value = row[col] ?? null;
                    const isSelected = selected?.row === item.index && selected.col === col;
                    const isCopied = copied?.row === item.index && copied.col === col;

                    return (
                      <div
                        aria-colindex={col + 1}
                        aria-selected={isSelected}
                        className={cn(
                          // Separators go on the top of a row, never the bottom: a grid of divs
                          // cannot `border-collapse`, so the container draws its own bottom edge
                          // and two 1px lines a pixel apart never read as a double border.
                          "relative flex h-7 items-center border-border border-t border-r px-2 outline-none last:border-r-0",
                          // The header already ruled off below itself.
                          item.index === 0 && "border-t-0",
                          column.align === "right" && "justify-end tabular-nums",
                          isSelected && "inset-ring-1 inset-ring-ring",
                        )}
                        data-cell={`${item.index}:${col}`}
                        key={col}
                        onClick={() => setSelected({ row: item.index, col })}
                        onDoubleClick={() => copy({ row: item.index, col }, value)}
                        role="gridcell"
                        tabIndex={isSelected ? 0 : -1}
                      >
                        {value === null ? (
                          <span className="text-muted-foreground italic">null</span>
                        ) : (
                          <span className="truncate">{String(value)}</span>
                        )}
                        {/* Lifts in and leaves upward, the way it did before the rewrite — a chip
                            that blinks on and off reads as a glitch rather than as feedback. */}
                        <AnimatePresence>
                          {isCopied && (
                            <motion.span
                              animate={{ opacity: 1, y: 0 }}
                              className="pointer-events-none absolute top-0 right-1 z-20 rounded-sm border border-border bg-popover px-1 font-sans text-popover-foreground text-xs"
                              exit={{ opacity: 0, y: -2 }}
                              initial={reduced ? false : { opacity: 0, y: 2 }}
                              transition={{ duration: reduced ? 0 : FADE_S, ease: FADE_EASE }}
                            >
                              Copied
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

