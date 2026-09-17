"use client";

// The card every scene on the stage is drawn on, and the bar across the top of it.

import { motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { useT } from "./walk-motion";

/**
 * A card of the stage: it fades in, fades out, and animates its POSITION and nothing else.
 *
 * A bare `layout` animates a card's width and height by SCALING it and then un-scaling every
 * projection node inside, which is both the most expensive thing on this stage — a correction
 * written to every child, every frame — and a second animation of a height that is already moving,
 * because the rows inside are collapsing out on their own clock. Two springs on one height is
 * exactly the stutter that looked like. A card follows its content the way any other element does,
 * and only its position, when a neighbour resizes, is animated. Nothing inside it is scaled, so
 * nothing inside it has to be corrected.
 */
export function WalkCard({
  ariaLabel,
  children,
  className,
  role,
  style,
}: {
  readonly ariaLabel?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly role?: string;
  /** Custom properties the rows inside read their spacers off. See `Table` in `stage.tsx`. */
  readonly style?: React.CSSProperties;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-label={ariaLabel}
      className={cn("shrink-0 overflow-hidden rounded-lg border bg-card shadow-sm/5", className)}
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      layout="position"
      role={role}
      style={style}
      transition={{ layout: t.spring, default: t.fade }}
    >
      {children}
    </motion.div>
  );
}

/** The bar across the top of a card: a title on the left, a count on the right. */
export function WalkCardHeader({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex h-8 items-center gap-2 border-b bg-muted/60 px-2.5 font-medium text-xs">
      {children}
    </div>
  );
}
