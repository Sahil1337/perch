"use client";

// The editor grid: tabs you can drag into splits, the way an IDE does it. Three parts, kept apart:
// `pane-layout.ts` is the model, a pure tree that every drag ends as one call into;
// `react-resizable-panels` draws it and owns the resize math; `@dnd-kit` moves the tabs.
//
// Persistence hangs off `onLayoutChanged`, not `onLayoutChange`, which fires on every pointer move.
//
// The grid does not own the buffer list, so the tree is reconciled against the panes that exist on
// the way to being rendered. See `reconcile`.

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { useWorkspace } from "../context";
import {
  RESULTS_PANE,
  activatePane,
  bufferPaneId,
  findGroup,
  focusGroup,
  groupOf,
  movePane,
  paneBufferId,
  setBranchSizes,
  reconcile,
  type EditorLayout,
  type PaneHome,
  type PaneId,
} from "../pane-layout";
import { useHotkey } from "../use-hotkey";
import { collisionDetection, resolveDrop, sameTarget, type DropTarget } from "./dnd";
import { DragGhost } from "./drop-affordances";
import { GridContext, type GridContextValue } from "./grid-context";
import { RESULTS_EXIT_MS } from "./pane-body";
import { NodeView } from "./tree-view";

/** Where the results pane goes when ⌘J brings it back, rather than as a tab beside a query. */
const HOMES: Readonly<Record<PaneId, PaneHome>> = {
  [RESULTS_PANE]: { edge: "bottom", size: 38 },
};

export function EditorGrid({
  layout,
  onLayoutChange,
  className,
}: {
  layout: EditorLayout;
  /** The app persists this; see apps/web/lib/use-panels.ts. */
  onLayoutChange: (layout: EditorLayout) => void;
  className?: string;
}): React.ReactElement {
  const { buffers, activeBufferId, panels, closeBuffer, focusBuffer, newScratch, setPanel } =
    useWorkspace();

  const reduced = useReducedMotion();

  /**
   * A notebook hands each cell its own result, so the pane below would show a run unrelated to the
   * cell in view. Derived, never written back: `panels.outputOpen` is what ⌘J chose, and closing the
   * pane on the user's behalf would lose it. In a split the pane follows focus.
   */
  const notebookFocused =
    buffers.find((buffer) => buffer.id === activeBufferId)?.view === "notebook";

  /**
   * The auto-hide is a default, not a lock: asking for the pane while a notebook has focus wins,
   * until focus moves and the default applies again. Otherwise ⌘J would just look broken.
   */
  const [override, setOverride] = React.useState(false);
  React.useEffect(() => setOverride(false), [activeBufferId]);

  const openedBefore = React.useRef(panels.outputOpen);
  React.useEffect(() => {
    if (panels.outputOpen && !openedBefore.current && notebookFocused) setOverride(true);
    openedBefore.current = panels.outputOpen;
  }, [panels.outputOpen, notebookFocused]);

  const wanted = panels.outputOpen && (!notebookFocused || override);

  // Held one beat past `wanted` so the pane can animate out before the layout takes its space back.
  const [mounted, setMounted] = React.useState(wanted);
  React.useEffect(() => {
    if (wanted) {
      setMounted(true);
      return;
    }
    if (reduced) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), RESULTS_EXIT_MS);
    return () => clearTimeout(timer);
  }, [wanted, reduced]);

  const available = React.useMemo(
    () => [...buffers.map((buffer) => bufferPaneId(buffer.id)), ...(mounted ? [RESULTS_PANE] : [])],
    [buffers, mounted],
  );

  // Derived during render, so a newly opened file is never missing for a frame. `reconcile` returns
  // its argument by reference when there is nothing to do, which stops the write-back looping.
  const view = reconcile(layout, available, HOMES);
  React.useEffect(() => {
    if (view !== layout) onLayoutChange(view);
  }, [view, layout, onLayoutChange]);

  // Focusing a buffer from outside the grid brings its tab forward wherever it lives.
  React.useEffect(() => {
    if (!activeBufferId) return;
    const pane = bufferPaneId(activeBufferId);
    const owner = groupOf(view.root, pane);
    if (!owner) return;
    const next = activatePane(view, owner.id, pane);
    if (next !== view) onLayoutChange(next);
  }, [activeBufferId, view, onLayoutChange]);

  const [dragging, setDragging] = React.useState<PaneId | null>(null);
  const [drop, setDrop] = React.useState<DropTarget | null>(null);
  const pointer = React.useRef<{ x: number; y: number } | null>(null);

  // dnd-kit reports which droppable is under the pointer but not where inside it, which is what
  // decides between a move and a split.
  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent): void => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [dragging]);

  const sensors = useSensors(
    // A tab is a button first, so a drag must travel before it starts or every click becomes a
    // one-pixel drag that swallows the activation.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const activate = React.useCallback(
    (groupId: string, pane: PaneId): void => {
      onLayoutChange(activatePane(view, groupId, pane));
      const bufferId = paneBufferId(pane);
      if (bufferId) focusBuffer(bufferId);
    },
    [view, onLayoutChange, focusBuffer],
  );

  // Closing goes through the workspace: the buffer list decides which panes exist, and
  // `reconcile` prunes the tab on the way back down.
  const close = React.useCallback(
    (pane: PaneId): void => {
      const bufferId = paneBufferId(pane);
      if (bufferId) closeBuffer(bufferId);
      else if (pane === RESULTS_PANE) setPanel("outputOpen", false);
    },
    [closeBuffer, setPanel],
  );

  const addScratch = React.useCallback(
    (groupId: string): void => {
      // Focus first: a new buffer lands in the focused group, and "+" means "here", not "there".
      onLayoutChange(focusGroup(view, groupId));
      newScratch();
    },
    [view, onLayoutChange, newScratch],
  );

  const resize = React.useCallback(
    (branchId: string, sizes: number[]): void => {
      onLayoutChange(setBranchSizes(view, branchId, sizes));
    },
    [view, onLayoutChange],
  );

  useHotkey({ key: "\\", mod: true }, () => {
    const group = findGroup(view.root, view.focusedGroup);
    if (!group?.activePane) return;
    onLayoutChange(movePane(view, group.activePane, group.id, "right"));
  });

  const onDragStart = ({ active }: DragStartEvent): void => {
    setDragging(String(active.id));
  };

  const onDragMove = ({ over }: DragMoveEvent): void => {
    const next = resolveDrop(over, pointer.current, view);
    setDrop((previous) => (sameTarget(previous, next) ? previous : next));
  };

  const onDragEnd = ({ active }: DragEndEvent): void => {
    const pane = String(active.id);
    const target = drop;
    setDragging(null);
    setDrop(null);
    if (!target) return;
    onLayoutChange(movePane(view, pane, target.groupId, target.edge, target.index));
    const bufferId = paneBufferId(pane);
    if (bufferId) focusBuffer(bufferId);
  };

  const context: GridContextValue = {
    layout: view,
    drop,
    resultsLeaving: mounted && !wanted,
    activate,
    close,
    addScratch,
    resize,
  };

  return (
    <DndContext
      collisionDetection={collisionDetection}
      onDragCancel={() => {
        setDragging(null);
        setDrop(null);
      }}
      onDragEnd={onDragEnd}
      onDragMove={onDragMove}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      <GridContext.Provider value={context}>
        <div className={cn("min-h-0 min-w-0", className)}>
          <NodeView node={view.root} />
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <DragGhost pane={dragging} /> : null}
        </DragOverlay>
      </GridContext.Provider>
    </DndContext>
  );
}
