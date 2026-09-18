import type { Cell, ResultColumn } from "@perch/protocol";
import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { FADE_EASE, FADE_S } from "../../lib/motion";
import { cn } from "../../lib/utils";
import type { CellRef } from "./use-grid-selection";

/**
 * The cascade a result lands with. `delay` is capped at `ROW_STAGGER_MAX` so a 1000-row result does
 * not take twelve seconds to arrive: past that, every row shares the last delay and they land
 * together, which reads as "and the rest".
 */
const ROW_STAGGER_S = 0.012;
const ROW_STAGGER_MAX = 12;

/**
 * One rendered row of the window. `index` is the row's absolute index in the result, not its
 * position in the window — everything visible hangs off it, because a windowed row's DOM position
 * changes as you scroll.
 */
export function GridRow({
  columns,
  copied,
  index,
  onCopy,
  onSelect,
  reduced,
  row,
  selected,
  staggered,
}: {
  columns: readonly ResultColumn[];
  copied: CellRef | null;
  index: number;
  onCopy: (ref: CellRef, value: Cell) => void;
  onSelect: (ref: CellRef) => void;
  reduced: boolean | null;
  row: readonly Cell[];
  selected: CellRef | null;
  staggered: boolean;
}): React.ReactElement {
  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-rowindex={index + 2}
      className={cn(
        "grid grid-cols-(--perch-grid-cols) hover:bg-accent/40",
        // Zebra by absolute index: a windowed row's DOM position changes as you
        // scroll, so an nth-child stripe would crawl.
        index % 2 === 1 && "bg-muted/40",
      )}
      initial={staggered ? { opacity: 0 } : false}
      role="row"
      transition={{
        duration: FADE_S,
        delay: Math.min(index, ROW_STAGGER_MAX) * ROW_STAGGER_S,
      }}
    >
      {columns.map((column, col) => {
        const value = row[col] ?? null;
        const isSelected = selected?.row === index && selected.col === col;
        const isCopied = copied?.row === index && copied.col === col;

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
              index === 0 && "border-t-0",
              column.align === "right" && "justify-end tabular-nums",
              isSelected && "inset-ring-1 inset-ring-ring",
            )}
            data-cell={`${index}:${col}`}
            key={col}
            onClick={() => onSelect({ row: index, col })}
            onDoubleClick={() => onCopy({ row: index, col }, value)}
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
}
