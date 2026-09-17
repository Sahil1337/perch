"use client";

import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useFade } from "../lib/motion";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { requestSaveQuery } from "./save-query-dialog";
import { useWorkspace } from "./context";
import { ErrorText } from "./error-text";
import { SAVE_LABEL, isScratch } from "./types";

/**
 * Whether the buffer is on disk yet.
 *
 * With autosave on, saving is something that happens to you rather than something you do, so the
 * only honest thing the UI can offer is a running answer to "is my work safe" — and the answer has
 * to stay legible while it changes, which is why every state renders in the same slot at the same
 * size instead of appearing and disappearing.
 *
 * `withToggle` exists because autosave is the setting people reach for exactly when they are
 * looking at this indicator and do not like what it says. Putting it behind this control means the
 * fix is where the complaint is, rather than in a preferences pane.
 */
export function SaveIndicator({
  withToggle = false,
  className,
}: {
  /** Adds a menu with the autosave checkbox and an explicit "Save now". */
  withToggle?: boolean;
  className?: string;
}): React.ReactElement {
  const { activeBuffer, saveState, settings, updateSettings } = useWorkspace();
  const fade = useFade();

  // A scratch buffer has nowhere to be written, so every save state is a lie about it — "Unsaved
  // changes" most of all, which implies work is at risk when nothing was ever going to be kept.
  const scratch = activeBuffer !== undefined && isScratch(activeBuffer);

  // The states swap by crossfade with a hair of lift, so the slot reads as one thing changing its
  // mind rather than four separate labels taking turns. `mode="wait"` keeps them from overlapping.
  const label = (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap text-xs",
          saveState === "error" ? "text-destructive-foreground" : "text-muted-foreground",
          !withToggle && className,
        )}
        exit={{ opacity: 0, y: -3 }}
        initial={{ opacity: 0, y: 3 }}
        key={scratch ? "scratch" : saveState}
        transition={fade}
      >
        {!scratch && saveState === "saving" && <Spinner className="size-3" />}
        {!scratch && saveState === "saved" && <CheckIcon className="size-3" />}
        {scratch ? "Not saved to a file" : SAVE_LABEL[saveState]}
      </motion.span>
    </AnimatePresence>
  );

  if (!withToggle) return label;

  const autosave =
    settings.status === "ready" || settings.status === "error"
      ? settings.data?.autosave
      : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className={className} size="xs" variant="ghost" />}>
        {label}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52" side="top">
        {(settings.status === "loading" || settings.status === "idle") && (
          <div className="p-1">
            <Skeleton className="h-5 w-full" />
          </div>
        )}

        {settings.status === "error" && settings.data === undefined && (
          <ErrorText className="px-2 py-1">{settings.error}</ErrorText>
        )}

        {autosave !== undefined && (
          <>
            {settings.status === "error" && (
              <ErrorText className="px-2 py-1">{settings.error}</ErrorText>
            )}
            <DropdownMenuCheckboxItem
              checked={autosave}
              onCheckedChange={(checked) => {
                void updateSettings({ autosave: checked }).catch(() => {});
              }}
            >
              <span className="flex items-center gap-1.5">
                Autosave
                {settings.status === "ready" && settings.stale && (
                  <Spinner aria-label="Refreshing" className="size-3" />
                )}
              </span>
            </DropdownMenuCheckboxItem>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={requestSaveQuery}>
          Save now
          <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
