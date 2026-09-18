import { FileTextIcon, NotebookIcon, XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { type Buffer, isScratch } from "../types";

/**
 * One open tab. The row and its close control are sibling buttons inside a presentational wrapper,
 * since a button nested in a button is invalid HTML and unreachable by keyboard. The close control
 * keeps its slot whether or not the pointer is here, so revealing it never shifts the name.
 */
export function BufferRow({
  active,
  buffer,
  onClose,
  onFocus,
}: {
  active: boolean;
  buffer: Buffer;
  onClose: () => void;
  onFocus: () => void;
}): React.ReactElement {
  const scratch = isScratch(buffer);
  const Icon = buffer.view === "notebook" ? NotebookIcon : FileTextIcon;

  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1 rounded-sm pe-1",
        "hover:bg-sidebar-accent/60",
        active && "bg-sidebar-accent",
      )}
    >
      <button
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-1.5 ps-2 text-left text-sm",
          "-outline-offset-2 cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring",
        )}
        onClick={onFocus}
        title={buffer.path ?? `${buffer.name} — scratch buffer, not saved to disk`}
        type="button"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn("truncate", scratch && "text-muted-foreground italic")}>
          {buffer.name}
        </span>
        {scratch ? (
          <Badge size="sm" variant="secondary">
            scratch
          </Badge>
        ) : (
          buffer.dirty && (
            // A dot says "unsaved" without stealing the width the filename needs.
            <span
              aria-label="Unsaved changes"
              className="size-1.5 shrink-0 rounded-full bg-foreground/70"
              role="img"
            />
          )
        )}
      </button>
      <Button
        aria-label={`Close ${buffer.name}`}
        className="shrink-0"
        onClick={onClose}
        size="icon-xs"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </div>
  );
}
