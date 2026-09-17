"use client";

// The 6px dot that says whether something is up.
//
// One component rather than four copies of the same three classes, because these dots sit in four
// different surfaces — the topbar picker, the status bar, the Settings list and the discovery
// scan — and a user reads them as one language. When they were four literals, one of them had
// quietly grown a third state the others did not have.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useSpring } from "../lib/motion";
import { cn } from "../lib/utils";

/** `error` is a server that answered badly; `idle` covers "not connected" and "not yet asked". */
export type DotStatus = "connected" | "error" | "idle";

const DOT_COLOR: Record<DotStatus, string> = {
  connected: "bg-success",
  error: "bg-destructive",
  idle: "bg-muted-foreground/40",
};

export function StatusDot({
  status,
  animate = false,
  label,
  className,
}: {
  status: DotStatus;
  /** Pops the dot on a status change. For the one dot that is watched, not a dot repeated in a list. */
  animate?: boolean;
  /** Announce the state, for the rows where the dot is the only thing carrying it. */
  label?: string;
  className?: string;
}): React.ReactElement {
  const spring = useSpring();

  const dot = (
    <span
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      className={cn("size-1.5 shrink-0 rounded-full", DOT_COLOR[status], className)}
      role={label === undefined ? undefined : "img"}
    />
  );

  if (!animate) return dot;

  // Connecting is slow and invisible, and a dot that simply *is* green throws away the only
  // feedback the topbar can give for work that just landed.
  return (
    <span className="relative inline-flex size-1.5 shrink-0 items-center justify-center">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          animate={{ scale: 1, opacity: 1 }}
          className="absolute inset-0 inline-flex items-center justify-center"
          exit={{ scale: 0.4, opacity: 0 }}
          initial={{ scale: 0.4, opacity: 0 }}
          key={status}
          transition={spring}
        >
          {dot}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** What a `ConnectionSummary.status` looks like as a dot. */
export function dotStatusOf(status: string | undefined): DotStatus {
  if (status === "connected") return "connected";
  if (status === "error") return "error";
  return "idle";
}
