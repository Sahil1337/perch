"use client";

// The card under an empty result: the rows that came closest, and how far off each one was.
//
// It arrives SETTLED, and that is the whole design rule. Ordering by closeness is a view choice —
// no ORDER BY produced it and the database never sorted anything — so nothing here staggers,
// flashes or slides into place. Every other card in the walk animates because something just
// happened to its rows; animating this one would say a step ran when none did, which is the one
// kind of lie this screen cannot afford. The only motion it has is the fade the whole card comes in
// on, which says "here is another card" and nothing about the data.
//
// It reuses the stage's vocabulary rather than inventing one: the same fail mark WHERE stamps on a
// row it threw away, the same monospaced cells, the same column widths.

import type { Cell } from "@perch/protocol";
import { motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { GAP } from "./terminus";
import { formatCell } from "../results-grid";
import type { Col, TerminusView } from "./scenes";
import { VerdictMark } from "./verdict-mark";
import { useT } from "./walk-motion";

export function TerminusCard({ view }: { readonly view: TerminusView }): React.ReactElement {
  const t = useT();
  return (
    <motion.section
      animate={{ opacity: 1 }}
      aria-label={`${view.title}: ${view.why}`}
      className="flex min-w-0 flex-col gap-1"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      <p className="px-0.5 text-muted-foreground text-xs">{view.title}</p>
      <div className="w-max max-w-full overflow-hidden rounded-lg border bg-card shadow-sm/5">
        <div className="flex h-7 items-stretch border-b">
          <div className="w-5.5 shrink-0" />
          {view.cols.map((col) => (
            <HeadCell col={col} key={col.id} />
          ))}
        </div>
        {view.rows.map((row) => (
          <div
            className="flex overflow-hidden border-b border-border/70 bg-destructive/8 last:border-b-0"
            key={row.key}
          >
            <div className="flex w-5.5 shrink-0 items-center justify-center">
              {/* `settled`, always: these rows were judged a chapter ago and re-stamping them here
                  would read as a test that just ran. */}
              <VerdictMark delayMs={0} settled verdict="fail" />
            </div>
            {view.cols.map((col) => (
              <BodyCell
                col={col}
                key={col.id}
                // The finding is not one of the row's database values, so it is not in `cells`.
                value={col.id === GAP ? row.gap : (row.cells[col.id] ?? null)}
              />
            ))}
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function HeadCell({ col }: { readonly col: Col }): React.ReactElement {
  return (
    <div
      className={cn(
        "flex h-7 w-(--w) shrink-0 items-center whitespace-nowrap px-2 font-mono text-xs",
        col.num && "justify-end",
        col.hl ? "bg-info/10 text-info-foreground" : "text-muted-foreground",
      )}
      style={{ "--w": `${col.width}px` } as React.CSSProperties}
    >
      <span className="truncate">{col.label}</span>
    </div>
  );
}

function BodyCell({ col, value }: { readonly col: Col; readonly value: Cell }): React.ReactElement {
  return (
    <div
      className={cn(
        "flex h-7 w-(--w) shrink-0 items-center truncate whitespace-nowrap px-2 font-mono text-xs tabular-nums",
        col.num && "justify-end",
        // The gap column is the finding, so it is lit; the rest are the row as the query spelled it.
        col.hl ? "bg-info/10 text-info-foreground" : "text-destructive-foreground",
      )}
      style={{ "--w": `${col.width}px` } as React.CSSProperties}
    >
      {formatCell(value)}
    </div>
  );
}
