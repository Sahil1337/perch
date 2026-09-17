import {
  findBranch,
  findGroup,
  groupOf,
  groups,
  insertBeside,
  normalizeSizes,
  paneGroup,
  replaceNode,
  singleGroup,
  withFocus,
} from "./tree";
import type { DropEdge, EditorLayout, PaneHome, PaneId, PaneNode } from "./types";

/** The tab that takes over when the active one closes: the next along, else the previous. */
function neighbour(panes: readonly PaneId[], removed: PaneId): PaneId | null {
  const at = panes.indexOf(removed);
  if (at < 0) return panes[0] ?? null;
  return panes[at + 1] ?? panes[at - 1] ?? null;
}

function insertAt(panes: readonly PaneId[], pane: PaneId, index?: number): readonly PaneId[] {
  const next = [...panes];
  next.splice(
    index === undefined ? next.length : Math.max(0, Math.min(index, next.length)),
    0,
    pane,
  );
  return next;
}

/** Brings a pane to the front of its group and gives that group focus. */
export function activatePane(layout: EditorLayout, groupId: string, pane: PaneId): EditorLayout {
  const target = findGroup(layout.root, groupId);
  if (!target || !target.panes.includes(pane)) return layout;
  if (target.activePane === pane && layout.focusedGroup === groupId) return layout;

  const root =
    target.activePane === pane
      ? layout.root
      : (replaceNode(layout.root, groupId, { ...target, activePane: pane }) ?? layout.root);
  return { root, focusedGroup: groupId };
}

export function focusGroup(layout: EditorLayout, groupId: string): EditorLayout {
  if (layout.focusedGroup === groupId || !findGroup(layout.root, groupId)) return layout;
  return { ...layout, focusedGroup: groupId };
}

/** Takes a pane out of the grid. Its group goes too if it was the last one in it. */
function removePane(layout: EditorLayout, pane: PaneId): EditorLayout {
  const owner = groupOf(layout.root, pane);
  if (!owner) return layout;

  const panes = owner.panes.filter((id) => id !== pane);
  const next: PaneNode | null =
    panes.length === 0
      ? null
      : {
          ...owner,
          panes,
          activePane: owner.activePane === pane ? neighbour(owner.panes, pane) : owner.activePane,
        };

  const root = replaceNode(layout.root, owner.id, next);
  // Keep the last group rather than an empty tree: the next file needs somewhere to open, and the
  // empty state needs somewhere to render.
  if (!root) return { root: paneGroup([], layout.focusedGroup), focusedGroup: layout.focusedGroup };
  return withFocus(root, layout.focusedGroup);
}

/**
 * The drop. `center` moves the pane into the target group's strip (at `index`, if the pointer was
 * over a particular tab); an edge splits the target and puts the pane in the new half.
 */
export function movePane(
  layout: EditorLayout,
  pane: PaneId,
  targetGroupId: string,
  edge: DropEdge,
  index?: number,
): EditorLayout {
  const source = groupOf(layout.root, pane);
  const target = findGroup(layout.root, targetGroupId);
  if (!target) return layout;

  if (edge === "center") {
    // Within its own strip this is a reorder; dropping a tab where it started writes nothing.
    if (source?.id === targetGroupId) {
      const without = target.panes.filter((id) => id !== pane);
      const at =
        index === undefined ? without.length : Math.max(0, Math.min(index, target.panes.length));
      const before = target.panes.slice(0, at).filter((id) => id !== pane).length;
      const panes = insertAt(without, pane, before);
      if (panes.every((id, position) => id === target.panes[position])) {
        return activatePane(layout, targetGroupId, pane);
      }
      const root = replaceNode(layout.root, targetGroupId, { ...target, panes, activePane: pane });
      return root ? { root, focusedGroup: targetGroupId } : layout;
    }

    const detached = removePane(layout, pane);
    const host = findGroup(detached.root, targetGroupId);
    if (!host) return layout;
    const root = replaceNode(detached.root, targetGroupId, {
      ...host,
      panes: insertAt(host.panes, pane, index),
      activePane: pane,
    });
    return root ? { root, focusedGroup: targetGroupId } : layout;
  }

  // Splitting a lone pane off its own group would empty and collapse it again, so the pane would
  // jump for a frame and land exactly where it was.
  if (source?.id === targetGroupId && source.panes.length === 1) return layout;

  const detached = source ? removePane(layout, pane) : layout;
  if (!findGroup(detached.root, targetGroupId)) return layout;

  const fresh = paneGroup([pane]);
  const direction = edge === "left" || edge === "right" ? "row" : "column";
  const before = edge === "left" || edge === "top";
  const root = insertBeside(detached.root, targetGroupId, fresh, direction, before, 50);
  return { root, focusedGroup: fresh.id };
}

/** Adds a pane the grid does not have yet, against an edge of the focused group. */
export function openPane(layout: EditorLayout, pane: PaneId, home: PaneHome): EditorLayout {
  if (groupOf(layout.root, pane)) return activatePane(layout, groupOf(layout.root, pane)!.id, pane);

  const host = findGroup(layout.root, layout.focusedGroup) ?? groups(layout.root)[0];
  if (!host) return { ...singleGroup([pane]) };

  const fresh = paneGroup([pane]);
  const direction = home.edge === "left" || home.edge === "right" ? "row" : "column";
  const before = home.edge === "left" || home.edge === "top";
  const root = insertBeside(layout.root, host.id, fresh, direction, before, home.size);
  return { root, focusedGroup: layout.focusedGroup };
}

/** Persists a drag of one branch's resize handles. */
export function setBranchSizes(
  layout: EditorLayout,
  branchId: string,
  sizes: readonly number[],
): EditorLayout {
  const branch = findBranch(layout.root, branchId);
  if (!branch || branch.sizes.length !== sizes.length) return layout;
  // Sub-pixel churn from the resize observer would otherwise write to localStorage on every frame.
  if (branch.sizes.every((size, index) => Math.abs(size - (sizes[index] ?? 0)) < 0.5))
    return layout;

  const root = replaceNode(layout.root, branchId, { ...branch, sizes: normalizeSizes(sizes) });
  return root ? { ...layout, root } : layout;
}
