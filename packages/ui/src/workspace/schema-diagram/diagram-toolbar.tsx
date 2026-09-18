import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  KeyRoundIcon,
  RotateCcwIcon,
  ScanIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import type * as React from "react";
import { plural } from "../../lib/format";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ToolButton } from "./diagram-chrome";

const ZOOM_STEP = 1.2;

export function DiagramToolbar({
  counts,
  database,
  keysOnly,
  onFit,
  onKeysOnly,
  onReset,
  onZoom,
  zoom,
}: {
  /** What the schema holds, once it has loaded. */
  counts: { tables: number; relations: number } | null;
  database: string | null;
  keysOnly: boolean;
  onFit: () => void;
  onKeysOnly: (next: boolean) => void;
  onReset: () => void;
  onZoom: (factor: number) => void;
  zoom: number;
}): React.ReactElement {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="font-medium text-sm leading-none">
          Relationships
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 truncate text-muted-foreground text-xs">
          {database ?? "No database"}
          {counts && (
            <>
              {" · "}
              {plural(counts.tables, "table")}
              {" · "}
              {plural(counts.relations, "relation")}
            </>
          )}
        </DialogPrimitive.Description>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-pressed={keysOnly}
                onClick={() => onKeysOnly(!keysOnly)}
                size="xs"
                variant={keysOnly ? "secondary" : "ghost"}
              >
                <KeyRoundIcon />
                Keys only
              </Button>
            }
          />
          <TooltipPopup>
            {keysOnly ? "Show every column" : "Show only the columns that take part in a relation"}
          </TooltipPopup>
        </Tooltip>
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
        <ToolButton label="Zoom out" onClick={() => onZoom(1 / ZOOM_STEP)}>
          <ZoomOutIcon />
        </ToolButton>
        <span className="w-10 text-center font-mono text-muted-foreground text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <ToolButton label="Zoom in" onClick={() => onZoom(ZOOM_STEP)}>
          <ZoomInIcon />
        </ToolButton>
        <ToolButton label="Fit to view" onClick={onFit}>
          <ScanIcon />
        </ToolButton>
        <ToolButton label="Reset layout" onClick={onReset}>
          <RotateCcwIcon />
        </ToolButton>
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
        <DialogPrimitive.Close
          aria-label="Close"
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <XIcon />
        </DialogPrimitive.Close>
      </div>
    </header>
  );
}
