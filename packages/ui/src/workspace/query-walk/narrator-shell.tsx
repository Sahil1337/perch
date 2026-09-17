"use client";

// The panel beside the stage: what is happening, and the SQL it happened with.
//
// The station narrator and the per-row panel are two readings of the same thing and share this
// frame on purpose — a reader who moves from a station walk into a per-row chapter should not feel
// they have changed screens.

import type * as React from "react";
import { cn } from "../../lib/utils";

export function NarratorShell({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  return (
    <aside
      aria-label="Narrator"
      className={cn("flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border bg-card p-4", className)}
    >
      {children}
    </aside>
  );
}
