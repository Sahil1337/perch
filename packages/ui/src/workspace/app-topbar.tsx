"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/**
 * The 48px bar across the top. Pure layout: it takes three slots and owns none of their state, so
 * a surface can put whatever it needs in them without this file growing a prop per feature.
 */
export function AppTopbar({
  start,
  center,
  end,
  className,
}: {
  start?: React.ReactNode;
  center?: React.ReactNode;
  end?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-border border-b bg-sidebar px-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">{start}</div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">{center}</div>
      <div className="flex min-w-0 items-center gap-2">{end}</div>
    </header>
  );
}
