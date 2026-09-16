"use client";

// Settings.
//
// Five panes behind a left nav, at a fixed 720×520 so the dialog never resizes under the cursor
// when you switch sections — a preferences window that changes shape as you browse it is one you
// stop trusting to stay where you put it. The active pane is marked by one indicator that slides
// (`layoutId`) rather than by five that blink, which is the difference between "this moved" and
// "something else is selected now".
//
// There is no Save button; see saved-tick.tsx for why, and for the receipt that replaces it.

import type { Settings } from "@perch/protocol";
import { DatabaseIcon, FolderIcon, PaletteIcon, SquareTerminalIcon, TableIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useFade, useSpring } from "../lib/motion";
import { cn } from "../lib/utils";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { useWorkspace } from "../workspace/context";
import { asyncData } from "../workspace/types";
import { ConnectionsSection } from "./connections-section";
import { SavedTick, useSettingsWriter } from "./saved-tick";
import { AppearanceSection, EditorSection, FilesSection, QuerySection } from "./sections";

const PANES = [
  { id: "editor", title: "Editor", icon: SquareTerminalIcon },
  { id: "query", title: "Query", icon: TableIcon },
  { id: "files", title: "Files", icon: FolderIcon },
  { id: "connections", title: "Connections", icon: DatabaseIcon },
  { id: "appearance", title: "Appearance", icon: PaletteIcon },
] as const;

type PaneId = (typeof PANES)[number]["id"];

export type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.ReactElement {
  const { settings } = useWorkspace();
  const writer = useSettingsWriter();
  const spring = useSpring();
  const fade = useFade();

  const [pane, setPane] = React.useState<PaneId>("editor");

  const value = asyncData(settings);
  const active = PANES.find((item) => item.id === pane) ?? PANES[0];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="h-130 max-w-180 flex-row">
        <nav
          aria-label="Settings sections"
          className="flex w-44 shrink-0 flex-col gap-1 border-border border-r p-3"
        >
          <DialogTitle className="mx-2 mt-1 mb-3">Settings</DialogTitle>
          {PANES.map((item) => (
            <button
              aria-current={pane === item.id ? "page" : undefined}
              className={cn(
                "relative flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                pane === item.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              key={item.id}
              onClick={() => setPane(item.id)}
              type="button"
            >
              {pane === item.id && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-accent"
                  layoutId="settings-pane-indicator"
                  transition={spring}
                />
              )}
              <item.icon aria-hidden className="relative size-4 shrink-0" />
              <span className="relative min-w-0 truncate">{item.title}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-border border-b pr-12 pl-4">
            <h3 className="font-medium text-sm">{active.title}</h3>
            <SavedTick writer={writer} />
          </header>

          <ScrollArea className="min-h-0 flex-1" overscrollContain scrollFade>
            {/* `popLayout`, not `wait`. `wait` runs the exit to completion before the enter starts, so for
          the length of both transitions this region holds nothing at all — and a region holding
          nothing has no height, so the box collapses and springs back. That collapse is the flicker.
          `popLayout` takes the outgoing copy out of flow instead, and the incoming one occupies the
          space on the same frame: a crossfade, with the geometry never leaving. */}
            <div className="relative flex flex-col gap-1 p-4">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-1"
                  exit={{ opacity: 0, y: -4 }}
                  initial={{ opacity: 0, y: 4 }}
                  key={pane}
                  transition={fade}
                >
                  {pane === "connections" ? (
                    <ConnectionsSection />
                  ) : value === undefined ? (
                    <SettingsSkeleton status={settings.status} />
                  ) : (
                    <Panes pane={pane} settings={value} writer={writer} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </ScrollArea>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function Panes({
  pane,
  settings,
  writer,
}: {
  pane: PaneId;
  settings: Settings;
  writer: ReturnType<typeof useSettingsWriter>;
}): React.ReactElement | null {
  if (pane === "editor") return <EditorSection settings={settings} writer={writer} />;
  if (pane === "query") return <QuerySection settings={settings} writer={writer} />;
  if (pane === "files") return <FilesSection settings={settings} writer={writer} />;
  if (pane === "appearance") return <AppearanceSection settings={settings} writer={writer} />;
  return null;
}

function SettingsSkeleton({ status }: { status: string }): React.ReactElement {
  if (status === "error") {
    return (
      <p className="text-destructive-foreground text-xs" role="alert">
        Settings could not be loaded.
      </p>
    );
  }
  return (
    <div aria-label="Loading settings" className="flex flex-col gap-4 py-2">
      {[0, 1, 2].map((row) => (
        <div className="flex items-center justify-between gap-4" key={row}>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-7 w-28" />
        </div>
      ))}
    </div>
  );
}
