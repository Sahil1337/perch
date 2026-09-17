// The drop edge is measured from the pointer to each border rather than from edge-shaped
// droppables, because rectangles cannot express "nearest border wins" at a corner — four 25% strips
// overlap there, and whichever is first in the collision list would take the drop.

import { pointerWithin, type CollisionDetection, type DragMoveEvent } from "@dnd-kit/core";
import { findGroup, type DropEdge, type EditorLayout, type PaneId } from "../pane-layout";

/** How near a border counts as a split rather than a plain move, as a fraction of the pane. */
const EDGE_BAND = 0.26;

export type DropTarget = {
  readonly groupId: string;
  readonly edge: DropEdge;
  /** Set only for a drop on a tab strip: where in the strip the tab lands. */
  readonly index?: number;
};

/**
 * Tab beats strip beats body. All three are nested, so the pointer is inside several at once and
 * rect geometry would decide instead of intent. The id prefixes already encode the specificity.
 */
export const collisionDetection: CollisionDetection = (args) => {
  const rank = (id: string): number =>
    id.startsWith("tab::") ? 0 : id.startsWith("strip::") ? 1 : 2;
  return [...pointerWithin(args)].sort((a, b) => rank(String(a.id)) - rank(String(b.id)));
};

export function resolveDrop(
  over: DragMoveEvent["over"],
  point: { x: number; y: number } | null,
  layout: EditorLayout,
): DropTarget | null {
  const data = over?.data.current as { kind?: string; groupId?: string; pane?: PaneId } | undefined;
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

export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.groupId === b.groupId && a.edge === b.edge && a.index === b.index;
}
