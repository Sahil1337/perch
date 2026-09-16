"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { useWorkspace } from "./context";

/** The 24px footer. One row for the whole window, not one per pane. */
export function StatusBar({
  items,
  className,
}: {
  /** Surface-specific extras, e.g. a notebook's cell count. */
  items?: React.ReactNode[];
  className?: string;
}): React.ReactElement {
  const { connection, database, cursor, saveState, activeRun } = useWorkspace();
  const connected = connection?.status === "connected";

  return (
    <footer
      className={cn(
        "flex h-6 shrink-0 items-center gap-4 border-border border-t bg-sidebar px-3 text-muted-foreground text-xs",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            connected ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
        {connection ? `${connection.name} · ${database ?? connection.database}` : "No connection"}
      </span>

      <span className="whitespace-nowrap tabular-nums">
        Ln {cursor.line}, Col {cursor.col}
      </span>

      <span className="whitespace-nowrap">{SAVE_LABEL[saveState]}</span>

      {activeRun?.durationMs !== undefined && (
        <span className="whitespace-nowrap tabular-nums">{activeRun.durationMs} ms</span>
      )}

      <span className="ml-auto whitespace-nowrap">UTF-8</span>

      {items?.map((item, index) => (
        <span className="whitespace-nowrap" key={index}>
          {item}
        </span>
      ))}
    </footer>
  );
}

const SAVE_LABEL = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  error: "Save failed",
} as const;
