"use client";

// The editor grid: tabs you can drag into splits, the way an IDE does it. Three parts, kept apart:
// `pane-layout.ts` is the model, a pure tree that every drag ends as one call into;
// `react-resizable-panels` draws it and owns the resize math; `@dnd-kit` moves the tabs.
//
// Persistence hangs off `onLayoutChanged`, not `onLayoutChange`, which fires on every pointer move.
//
// The drop edge is measured from the pointer to each border rather than from edge-shaped
// droppables, because rectangles cannot express "nearest border wins" at a corner — four 25% strips
// overlap there, and whichever is first in the collision list would take the drop.
//
// The grid does not own the buffer list, so the tree is reconciled against the panes that exist on
// the way to being rendered. See `reconcile`.

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import { FilePlusIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { useWorkspace } from "./context";
import { type Buffer } from "./types";
import { Notebook } from "./notebook";
import {
  RESULTS_PANE,
  activatePane,
  bufferPaneId,
  findGroup,
  focusGroup,
  groupOf,
  isGroup,
  movePane,
  paneBufferId,
  setBranchSizes,
  reconcile,
  type DropEdge,
  type EditorLayout,
  type PaneBranch,
  type PaneGroup,
  type PaneHome,
  type PaneId,
  type PaneNode,
} from "./pane-layout";
import { PaneLabel, PaneTabs, bodyDroppableId, usePaneLabel } from "./pane-tabs";
import { ResultsPanel } from "./results-panel";
import { SqlEditor } from "./sql-editor";
import { useHotkey } from "./use-hotkey";

/** Where the results pane goes when ⌘J brings it back, rather than as a tab beside a query. */
const HOMES: Readonly<Record<PaneId, PaneHome>> = {
  [RESULTS_PANE]: { edge: "bottom", size: 38 },
};

/**
 * How long the results pane takes to drop out of sight, in ms. It cannot simply be removed from the
 * layout — `reconcile` would reclaim the space on the same frame and the editor would snap taller —
 * so the tree keeps it for exactly this long. Must stay in step with the transition in `PaneBody`.
 */
const RESULTS_EXIT_MS = 260;

/** How near a border counts as a split rather than a plain move, as a fraction of the pane. */
const EDGE_BAND = 0.26;

/** A pane smaller than this is unreadable, and one dragged to nothing is a way to lose a query. */
const MIN_PANE = "12%";

type DropTarget = {
  readonly groupId: string;
  readonly edge: DropEdge;
  /** Set only for a drop on a tab strip: where in the strip the tab lands. */
  readonly index?: number;
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
    dragging,
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

/* ---------------------------------------------------------------- context */

type GridContextValue = {
  layout: EditorLayout;
  drop: DropTarget | null;
  dragging: PaneId | null;
  /** The results pane is on its way out; see `RESULTS_EXIT_MS`. */
  resultsLeaving: boolean;
  activate: (groupId: string, pane: PaneId) => void;
  close: (pane: PaneId) => void;
  addScratch: (groupId: string) => void;
  resize: (branchId: string, sizes: number[]) => void;
};

/** Local to the grid, so a branch need not forward eight props through arbitrary nesting. */
const GridContext = React.createContext<GridContextValue | null>(null);

function useGrid(): GridContextValue {
  const value = React.useContext(GridContext);
  if (!value) throw new Error("Grid internals must render inside <EditorGrid>.");
  return value;
}

/* ------------------------------------------------------------------ tree */

function NodeView({ node }: { node: PaneNode }): React.ReactElement {
  return isGroup(node) ? <GroupView group={node} /> : <BranchView branch={node} />;
}

function BranchView({ branch }: { branch: PaneBranch }): React.ReactElement {
  const { resize } = useGrid();
  const horizontal = branch.direction === "row";

  return (
    <Group
      className="h-full w-full"
      id={branch.id}
      // A `Layout` is keyed by panel id, not ordered, so it is read back through the children —
      // which also keeps it correct after a drop reorders them.
      onLayoutChanged={(layout: Layout) =>
        resize(
          branch.id,
          branch.children.map((child) => layout[child.id] ?? 0),
        )
      }
      orientation={horizontal ? "horizontal" : "vertical"}
      // The invisible target around the hairline: it should look like a rule and act like a handle.
      resizeTargetMinimumSize={{ coarse: 16, fine: 8 }}
    >
      {branch.children.map((child, index) => (
        <React.Fragment key={child.id}>
          {index > 0 && <Separator className={separatorClass(horizontal)} />}
          {/* A bare number would be read as pixels, so the percentage is spelled out. `id` is what
              ties a panel to its size when one is added or removed beside it. */}
          <Panel
            className="h-full w-full min-w-0"
            defaultSize={`${branch.sizes[index] ?? 0}%`}
            id={child.id}
            minSize={MIN_PANE}
          >
            <NodeView node={child} />
          </Panel>
        </React.Fragment>
      ))}
    </Group>
  );
}

function separatorClass(horizontal: boolean): string {
  return cn(
    "relative bg-border outline-none transition-colors hover:bg-primary focus-visible:bg-primary",
    horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
  );
}

function GroupView({ group }: { group: PaneGroup }): React.ReactElement {
  const { layout, drop, activate, close, addScratch } = useGrid();
  const { setNodeRef } = useDroppable({
    id: bodyDroppableId(group.id),
    data: { kind: "body", groupId: group.id },
  });

  const focused = layout.focusedGroup === group.id;
  const target = drop?.groupId === group.id ? drop : null;
  // A strip drop names an index and shows a caret; a body drop names a region and shades it.
  const insertAt = target && target.index !== undefined ? target.index : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <PaneTabs
        activePane={group.activePane}
        focused={focused}
        groupId={group.id}
        insertAt={insertAt}
        onActivate={(pane) => activate(group.id, pane)}
        onClose={close}
        onNew={() => addScratch(group.id)}
        panes={group.panes}
      />

      <div
        className="relative min-h-0 flex-1"
        onFocusCapture={() => {
          if (!focused && group.activePane) activate(group.id, group.activePane);
        }}
        ref={setNodeRef}
      >
        {/* Every pane in the group stays mounted; only the active one is visible.

            Rendering just the active pane meant a tab switch unmounted an editor and mounted
            another, and `PaneBody` keys `SqlEditor` by buffer id — so each switch tore down a
            CodeMirror instance and built a fresh one. That is the flash, and it took the cursor
            and the scroll position with it, which is the part people notice second.

            `invisible` rather than `hidden` on purpose: `visibility: hidden` keeps the element's
            box, so CodeMirror stays measured and has nothing to re-measure when it comes back —
            `display: none` would collapse it to zero and hand back a mis-sized editor on the next
            switch. It also drops the subtree out of the tab order and stops pointer events, so a
            hidden pane cannot be reached by accident. */}
        {group.activePane === null ? (
          <EmptyGroup />
        ) : (
          group.panes.map((pane) => (
            <div
              aria-hidden={pane !== group.activePane}
              className={cn("absolute inset-0", pane !== group.activePane && "invisible")}
              key={pane}
            >
              <PaneBody pane={pane} />
            </div>
          ))
        )}
        {target && target.index === undefined && <DropRegion edge={target.edge} />}
      </div>
    </div>
  );
}

/** What the drop will do, drawn over the pane it will do it to. */
function DropRegion({ edge }: { edge: DropEdge }): React.ReactElement {
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

function PaneBody({ pane }: { pane: PaneId }): React.ReactElement | null {
  const { buffers } = useWorkspace();
  const { resultsLeaving } = useGrid();
  const bufferId = paneBufferId(pane);

  // Out through the bottom edge it arrived on: any other exit reads as the pane being deleted.
  if (bufferId === null) {
    return (
      <motion.div
        animate={{ y: resultsLeaving ? "100%" : 0 }}
        className="h-full overflow-hidden"
        initial={false}
        transition={{ duration: RESULTS_EXIT_MS / 1000, ease: [0.4, 0, 1, 1] }}
      >
        <ResultsPanel className="h-full" />
      </motion.div>
    );
  }

  const buffer = buffers.find((candidate) => candidate.id === bufferId);
  if (!buffer) return null;

  // A notebook puts each result under the cell that produced it; the pane has nothing to add.
  const editor =
    buffer.view === "notebook" ? (
      <Notebook className="h-full min-h-0" fileId={buffer.id} key={buffer.id} />
    ) : (
      <SqlEditor className="h-full min-h-0" fileId={buffer.id} key={buffer.id} />
    );

  if (buffer.conflict === undefined) return editor;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConflictBar buffer={buffer} />
      <div className="min-h-0 flex-1">{editor}</div>
    </div>
  );
}

/**
 * Someone else changed the file while you had unsaved edits. There is no safe automatic answer —
 * reloading discards yours, keeping yours discards theirs — so both are offered and neither is
 * default. `resolveConflict` writes the choice and clears the flag.
 */
function ConflictBar({ buffer }: { buffer: Buffer }): React.ReactElement {
  const { resolveConflict } = useWorkspace();
  const [busy, setBusy] = React.useState<"reload" | "keep" | null>(null);

  async function choose(choice: "reload" | "keep"): Promise<void> {
    setBusy(choice);
    try {
      await resolveConflict(buffer.id, choice);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-warning/24 border-b bg-warning/8 px-3 py-1.5 text-xs"
      role="alert"
    >
      <TriangleAlertIcon className="size-3.5 shrink-0 text-warning-foreground" />
      <span className="min-w-0">
        <span className="font-medium">{buffer.name}</span> changed on disk while you were editing
        it.
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          disabled={busy !== null}
          loading={busy === "reload"}
          onClick={() => void choose("reload")}
          size="xs"
          variant="outline"
        >
          Use the file on disk
        </Button>
        <Button
          disabled={busy !== null}
          loading={busy === "keep"}
          onClick={() => void choose("keep")}
          size="xs"
          variant="outline"
        >
          Keep my version
        </Button>
      </div>
    </div>
  );
}

/**
 * An empty pane offers the thing you would do next. Naming ⌘P instead would assume a workspace —
 * with no folder open there are no files to find. An untitled query assumes nothing, which is why
 * perch is useful a second after connecting.
 */
function EmptyGroup(): React.ReactElement {
  const { newScratch } = useWorkspace();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
      <span>No file open</span>
      <Button onClick={() => newScratch()} size="sm" variant="outline">
        <FilePlusIcon />
        New query
      </Button>
      <span className="flex items-center gap-1.5 text-xs">
        or find a file with <Kbd>⌘P</Kbd>
      </span>
    </div>
  );
}

/** The tab that follows the pointer. Deliberately the same label component as the real tab. */
function DragGhost({ pane }: { pane: PaneId }): React.ReactElement {
  const label = usePaneLabel(pane);
  return (
    <div className="flex h-9 cursor-grabbing items-center gap-2 rounded-sm border border-border bg-background px-3 text-foreground text-sm shadow-lg">
      <PaneLabel label={label} />
    </div>
  );
}

/* ------------------------------------------------------------------ drop */

/**
 * Tab beats strip beats body. All three are nested, so the pointer is inside several at once and
 * rect geometry would decide instead of intent. The id prefixes already encode the specificity.
 */
const collisionDetection: CollisionDetection = (args) => {
  const rank = (id: string): number => (id.startsWith("tab::") ? 0 : id.startsWith("strip::") ? 1 : 2);
  return [...pointerWithin(args)].sort((a, b) => rank(String(a.id)) - rank(String(b.id)));
};

function resolveDrop(
  over: DragMoveEvent["over"],
  point: { x: number; y: number } | null,
  layout: EditorLayout,
): DropTarget | null {
  const data = over?.data.current as
    | { kind?: string; groupId?: string; pane?: PaneId }
    | undefined;
  if (!over || !data?.groupId) return null;

  if (data.kind === "tab" && data.pane) {
    const group = findGroup(layout.root, data.groupId);
    if (!group) return null;
    const at = group.panes.indexOf(data.pane);
    // Past the midpoint of a tab means after it — the same rule a text caret follows.
    const after = point ? point.x > over.rect.left + over.rect.width / 2 : false;
    return { groupId: data.groupId, edge: "center", index: Math.max(0, at) + (after ? 1 : 0) };
  }

  if (data.kind === "strip") {
    const group = findGroup(layout.root, data.groupId);
    return { groupId: data.groupId, edge: "center", index: group?.panes.length ?? 0 };
  }

  // Keyboard dragging has no pointer, so it can only ever mean "move into this group".
  const edge = point ? edgeAt(over.rect, point.x, point.y) : "center";
  return { groupId: data.groupId, edge };
}

/** Nearest border wins, and only when the pointer is actually near one. */
function edgeAt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): DropEdge {
  const px = (x - rect.left) / Math.max(1, rect.width);
  const py = (y - rect.top) / Math.max(1, rect.height);

  const borders: readonly (readonly [Exclude<DropEdge, "center">, number])[] = [
    ["left", px],
    ["right", 1 - px],
    ["top", py],
    ["bottom", 1 - py],
  ];

  let nearest = borders[0] as readonly [Exclude<DropEdge, "center">, number];
  for (const border of borders) if (border[1] < nearest[1]) nearest = border;
  return nearest[1] <= EDGE_BAND ? nearest[0] : "center";
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.groupId === b.groupId && a.edge === b.edge && a.index === b.index;
}
