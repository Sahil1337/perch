"use client";

// The chapter strip: the program's sections in order, above the station rail that walks whichever
// one is open. A section is a place in the query, not a detour — so this reads like a table of
// contents and every entry stays one click away, which is the whole reason the breadcrumb stack it
// replaced could go.

import { motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../../ui/spinner";
import type { SectionRun, SectionStatus } from "./use-walk";
import { useT } from "./walk-motion";

/** What a status means to someone reading the strip, for the accessible name and the tooltip. */
function note(run: SectionRun): string {
  switch (run.status) {
    case "pending":
      return "waiting";
    case "running":
      return "running";
    case "done":
      return "done";
    case "bound":
      return "runs once per row of the section above it";
    case "unwalkable":
      return "combines the branches";
  }
}

/** A section the parse could not prove runs exactly once has to say so somewhere. This is it. */
function caveat(run: SectionRun): string | null {
  const { binding } = run.section;
  return binding.kind === "standalone" && !binding.certain
    ? "reading the SQL could not rule out that this depends on the outer row"
    : null;
}

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
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
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
 * dashed when it is never going to run on its own — the same vocabulary the station rail uses, so
 * the two rows of dots mean the same thing.
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
            : "border-dashed border-muted-foreground/60 bg-card",
      )}
    />
  );
}
