// One group's tab strip.
//
// Every tab is a drag handle and the strip itself is a drop target. A tab and its close control are
// sibling buttons inside a presentational wrapper, not a button nested in a button, which would be
// invalid HTML and leave the close target unreachable by keyboard; the close control keeps its space
// whether or not it is visible, so revealing it cannot shove the filename sideways.
//
// The drag listeners sit on the label button alone, so the close control stays clickable while its
// tab is draggable. The insertion caret is a flex child spliced into the list at the index the drop
// would use, rather than a bar positioned from measured tab rects —
// same appearance, no measurement, and it cannot drift out of step with the drop it is promising.

import { PlusIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { useSpring } from "../lib/motion";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { useWorkspace } from "./context";
import { RESULTS_PANE, type PaneId, paneBufferId } from "./pane-layout";
import { isScratch } from "./types";

/** Droppable ids are namespaced because a tab is both a drag source and a drop target. */
export const stripDroppableId = (groupId: string): string => `strip::${groupId}`;
export const tabDroppableId = (groupId: string, pane: PaneId): string => `tab::${groupId}::${pane}`;
export const bodyDroppableId = (groupId: string): string => `body::${groupId}`;

export function PaneTabs({
  groupId,
  panes,
  activePane,
  focused,
  insertAt,
  onActivate,
  onClose,
  onNew,
}: {
  groupId: string;
  panes: readonly PaneId[];
  activePane: PaneId | null;
  /** Dims the strip of every group that is not the one the hotkeys act on. */
  focused: boolean;
  /** Where a tab being dragged over this strip would land, or null when none is. */
  insertAt: number | null;
  onActivate: (pane: PaneId) => void;
  onClose: (pane: PaneId) => void;
  onNew: () => void;
}): React.ReactElement {
  const { setNodeRef } = useDroppable({
    id: stripDroppableId(groupId),
    data: { kind: "strip", groupId },
  });

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-stretch border-border border-b",
        focused ? "bg-sidebar" : "bg-sidebar/60",
      )}
      ref={setNodeRef}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {panes.map((pane, index) => (
          <React.Fragment key={pane}>
            {insertAt === index && <InsertCaret />}
            <PaneTab
              active={pane === activePane}
              groupId={groupId}
              onActivate={() => onActivate(pane)}
              onClose={() => onClose(pane)}
              pane={pane}
            />
          </React.Fragment>
        ))}
        {insertAt === panes.length && <InsertCaret />}

        <div className="flex shrink-0 items-center px-1">
          <Button aria-label="New query" onClick={onNew} size="icon-xs" variant="ghost">
            <PlusIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Where the drop will put the tab. Sized like a text caret because that is what it is. */
function InsertCaret(): React.ReactElement {
  return <div aria-hidden className="my-1.5 w-0.5 shrink-0 rounded-full bg-primary" />;
}

function PaneTab({
  pane,
  groupId,
  active,
  onActivate,
  onClose,
}: {
  pane: PaneId;
  groupId: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}): React.ReactElement {
  const spring = useSpring();
  const label = usePaneLabel(pane);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: pane,
    data: { kind: "pane", pane, groupId },
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: tabDroppableId(groupId, pane),
    data: { kind: "tab", groupId, pane },
  });

  return (
    <div
      className={cn(
        "group/tab relative flex shrink-0 items-stretch border-border border-r transition-colors",
        active ? "bg-background" : "hover:bg-sidebar-accent",
        // The original stays in place at low opacity rather than being pulled out of the strip:
        // collapsing its width mid-drag reflows every tab after it and the drop target you were
        // aiming at slides out from under the pointer.
        isDragging && "opacity-40",
      )}
      ref={setDropRef}
    >
      <button
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex cursor-pointer items-center gap-2 pr-1 pl-3 text-sm outline-none focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
          active ? "text-foreground" : "text-muted-foreground",
        )}
        onClick={onActivate}
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
      >
        <PaneLabel label={label} />
      </button>

      <button
        aria-label={`Close ${label.name}`}
        className="my-2 mr-2 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/tab:opacity-100"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3" />
      </button>

      {/* One underline per group (`layoutId`), so switching tabs slides it across instead of
          blinking out here and in again there. Keyed by group: a single shared id would make the
          underline fly between splits, which reads as the panes swapping rather than the focus. */}
      {active && (
        <motion.span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
          layoutId={`pane-tab-indicator-${groupId}`}
          transition={spring}
        />
      )}
    </div>
  );
}

type PaneLabelText = {
  readonly name: string;
  readonly scratch: boolean;
  readonly dirty: boolean;
};

/** What a tab says. The results pane has no buffer behind it, so it is spelled out here. */
export function usePaneLabel(pane: PaneId): PaneLabelText {
  const { buffers } = useWorkspace();
  const bufferId = paneBufferId(pane);
  if (bufferId === null) {
    return { name: pane === RESULTS_PANE ? "Results" : pane, scratch: false, dirty: false };
  }
  const buffer = buffers.find((candidate) => candidate.id === bufferId);
  if (!buffer) return { name: "Untitled", scratch: false, dirty: false };
  return { name: buffer.name, scratch: isScratch(buffer), dirty: buffer.dirty };
}

/** Shared by the strip and the drag overlay, so the ghost cannot drift from the real tab. */
export function PaneLabel({ label }: { label: PaneLabelText }): React.ReactElement {
  return (
    <>
      <span className={cn("max-w-44 truncate", label.scratch && "italic")}>{label.name}</span>
      {/* A scratch has no disk copy, so it is never "unsaved" — it is just not a file. Saying so
          is more honest than a dot that implies work is at risk. */}
      {label.scratch && <span className="shrink-0 text-muted-foreground text-xs">scratch</span>}
      {label.dirty && (
        <span
          aria-label="Unsaved changes"
          className="size-1.5 shrink-0 rounded-full bg-foreground/70"
          role="img"
        />
      )}
    </>
  );
}
