"use client";

// The chapter strip: the program's sections in order, above the station rail that walks whichever
// one is open. A section is a place in the query, not a detour — so this reads like a table of
// contents and every entry stays one click away, which is the whole reason the breadcrumb stack it
// replaced could go.

import { RepeatIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../../ui/spinner";
import { caveat, describe, note } from "./narration/chapter-sentences";
import { runsPerRow, type SectionRun, type SectionStatus } from "./use-walk";
import { useT } from "./walk-motion";

export function Chapters({
  sections,
  active,
  onJump,
  writtenOrder,
}: {
  sections: readonly SectionRun[];
  active: number;
  onJump: (index: number) => void;
  /**
   * The statement's top level is a set operation. The strip then shows the branches in the order
   * they were WRITTEN, which is not the order they combine — see the caption below.
   */
  writtenOrder: boolean;
}): React.ReactElement {
  const t = useT();
  /** The chapter the rail below is walking, which the caption under the strip describes. */
  const open = sections[active];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* The padding is load-bearing for the same reason it is on the station rail: `overflow-x-auto`
          clips vertically too, and without it the scroll box shaves the focus ring off every pill. */}
      <nav aria-label="Sections" className="min-w-0 overflow-x-auto px-0.5 py-1">
        <ol className="flex min-w-max items-center gap-0.5">
          {sections.map((run, i) => {
            const isActive = i === active;
            const why = caveat(run);
            return (
              <li key={run.section.id}>
                <button
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`${run.section.label}, ${note(run)}${why ? `, ${why}` : ""}`}
                  className={cn(
                    "flex max-w-56 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-info/10 font-medium text-info-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => onJump(i)}
                  title={`${run.section.label} — ${note(run)}${why ? `. Note: ${why}.` : ""}`}
                  type="button"
                >
                  <Dot status={run.status} />
                  <span className="min-w-0 truncate font-mono">{run.section.label}</span>
                  {/* The strip is read left to right, and every OTHER chapter on it really does
                      precede what reads it — a CTE, a derived table, an uncorrelated subquery. A
                      per-row chapter does not: it is listed before the query that drives it the way
                      a footnote is printed before the page citing it. The dashed dot alone carries
                      too much of that, so the mark is said out loud here and explained under the
                      strip. The accessible name already says it in words. */}
                  {runsPerRow(run.status) && <RepeatIcon aria-hidden className="size-3 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {/* Which chapter is open, and what it is. Keyed on the section so it crossfades on a jump
          rather than swapping text under the reader's eye mid-sentence. */}
      <AnimatePresence initial={false} mode="wait">
        {open && (
          <motion.p
            animate={{ opacity: 1 }}
            className="px-1 text-muted-foreground text-xs"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={open.section.id}
            transition={t.fade}
          >
            <span className="font-mono text-foreground">{open.section.label}</span>
            <span className="tabular-nums">
              {" "}
              · {active + 1} of {sections.length}
            </span>{" "}
            — {describe(open, sections)}
          </motion.p>
        )}
      </AnimatePresence>
      {/* The companion to the mark on the pill. It stands whenever any chapter runs per row, rather
          than only when one is open, because the misreading it prevents happens while SCANNING the
          strip — by the time a reader has opened the chapter, `describe` has already told them. */}
      {sections.some((run) => runsPerRow(run.status)) && (
        <motion.p
          animate={{ opacity: 1 }}
          className="flex items-center gap-1 px-1 text-muted-foreground text-xs"
          initial={{ opacity: 0 }}
          transition={t.fade}
        >
          <RepeatIcon aria-hidden className="size-3 shrink-0" />
          <span>
            A chapter marked this way is listed before the query that drives it, but it runs once
            for every row of that query — not before it.
          </span>
        </motion.p>
      )}
      {/* Wave 1's rule, and the one place this screen could actively mislead: the branch list is
          flat and SQL binds INTERSECT tighter than UNION and EXCEPT, so a left-to-right reading of
          the strip is simply wrong. Saying so costs one line. */}
      {writtenOrder && (
        <motion.p
          animate={{ opacity: 1 }}
          className="px-1 text-muted-foreground text-xs"
          initial={{ opacity: 0 }}
          transition={t.fade}
        >
          Branches are listed in the order they are written, not the order they combine:{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground">INTERSECT</code>{" "}
          binds tighter than{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground">UNION</code> and{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground">EXCEPT</code>.
        </motion.p>
      )}
    </div>
  );
}

/**
 * The mark in front of a chapter. Filled once the section has its rows, hollow while it waits, and
 * dashed when it does not run as one piece — the same vocabulary the station rail uses, so the two
 * rows of dots mean the same thing.
 *
 * A `per-row` section gets the dash in the accent colour rather than the muted one: it is dashed
 * because it has no single result, not because it is inert, and since wave 4 it really does run —
 * once for every row of the section it is bound to.
 */
function Dot({ status }: { status: SectionStatus }): React.ReactElement {
  if (status === "running") return <Spinner className="size-2.5 shrink-0" />;
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full border transition-colors duration-200",
        status === "done"
          ? "border-info bg-info"
          : status === "pending"
            ? "border-border bg-card"
            : status === "per-row"
              ? "border-dashed border-info bg-card"
              : "border-dashed border-muted-foreground/60 bg-card",
      )}
    />
  );
}
