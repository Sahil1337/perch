import type * as React from "react";
import { cn } from "../lib/utils";
import { useWorkspace } from "./context";
import { StatusDot, dotStatusOf } from "./status-dot";
import { SAVE_LABEL } from "./types";

/** The 24px footer. One row for the whole window, not one per pane. */
export function StatusBar({ className }: { className?: string }): React.ReactElement {
  const { connection, database, cursor, saveState, activeRun } = useWorkspace();

  return (
    <footer
      className={cn(
        "flex h-6 shrink-0 items-center gap-4 border-border border-t bg-sidebar px-3 text-muted-foreground text-xs",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusDot status={dotStatusOf(connection?.status)} />
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
    </footer>
  );
}
