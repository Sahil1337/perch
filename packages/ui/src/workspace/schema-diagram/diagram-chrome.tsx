"use client";

import { KeyRoundIcon, Link2Icon } from "lucide-react";
import type * as React from "react";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";

export function ToolButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} onClick={onClick} size="icon-sm" variant="ghost">
            {children}
          </Button>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

export function Legend({ noRelations }: { noRelations: boolean }): React.ReactElement {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-md border bg-popover/90 px-2.5 py-2 text-muted-foreground text-xs backdrop-blur-sm">
      {noRelations ? (
        <span>No foreign keys in this database, so the tables are laid out without wires.</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <KeyRoundIcon className="size-3 text-warning-foreground" /> Primary key
          </span>
          <span className="flex items-center gap-1.5">
            <Link2Icon className="size-3 text-info-foreground" /> Foreign key
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-info" /> Reference, many → one
          </span>
        </>
      )}
      <span className="text-muted-foreground/70">Drag to move · scroll to pan · ⌘ scroll to zoom</span>
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}
