"use client";

import * as React from "react";
import { cn } from "../../lib/utils";
import { type DropEdge, type PaneId } from "../pane-layout";
import { PaneLabel, usePaneLabel } from "../pane-tabs";

/** What the drop will do, drawn over the pane it will do it to. */
export function DropRegion({ edge }: { edge: DropEdge }): React.ReactElement {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-20 rounded-sm bg-primary/15 inset-ring-1 inset-ring-primary transition-all",
        edge === "center" && "inset-0",
        edge === "left" && "inset-y-0 left-0 w-1/2",
        edge === "right" && "inset-y-0 right-0 w-1/2",
        edge === "top" && "inset-x-0 top-0 h-1/2",
        edge === "bottom" && "inset-x-0 bottom-0 h-1/2",
      )}
    />
  );
}

/** The tab that follows the pointer. Deliberately the same label component as the real tab. */
export function DragGhost({ pane }: { pane: PaneId }): React.ReactElement {
  const label = usePaneLabel(pane);
  return (
    <div className="flex h-9 cursor-grabbing items-center gap-2 rounded-sm border border-border bg-background px-3 text-foreground text-sm shadow-lg">
      <PaneLabel label={label} />
    </div>
  );
}
