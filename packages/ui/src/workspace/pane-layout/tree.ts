import type { EditorLayout, PaneBranch, PaneGroup, PaneId, PaneNode } from "./types";

/** The id an empty tree falls back to. Fixed, so a server render and a client render agree. */
export const ROOT_GROUP = "group-root";

/**
 * Random rather than sequential: a layout outlives its session, and a counter restarting at 1 would
 * collide with the "group-3" already in localStorage. Only called from event handlers, so it cannot
 * desync hydration.
 */
function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}


export function paneGroup(panes: readonly PaneId[], id = newId("group")): PaneGroup {
  return { kind: "group", id, panes, activePane: panes[panes.length - 1] ?? null };
}

/** One group holding everything — what a layout with no split looks like. */
export function singleGroup(panes: readonly PaneId[] = []): EditorLayout {
  const root = paneGroup(panes, ROOT_GROUP);
  return { root, focusedGroup: root.id };
}


export function isGroup(node: PaneNode): node is PaneGroup {
  return node.kind === "group";
}

/** Every group, left to right and top to bottom — the order the tabs appear on screen. */
export function groups(node: PaneNode): readonly PaneGroup[] {
  return isGroup(node) ? [node] : node.children.flatMap(groups);
}

export function findGroup(node: PaneNode, id: string): PaneGroup | undefined {
  return groups(node).find((group) => group.id === id);
}

export function findBranch(node: PaneNode, id: string): PaneBranch | undefined {
  if (isGroup(node)) return undefined;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findBranch(child, id);
    if (found) return found;
  }
  return undefined;
}

/** The one group holding `pane` — "one answer" is the invariant the whole model rests on. */
export function groupOf(node: PaneNode, pane: PaneId): PaneGroup | undefined {
  return groups(node).find((group) => group.panes.includes(pane));
}

export function panesOf(node: PaneNode): readonly PaneId[] {
  return groups(node).flatMap((group) => group.panes);
}


/** Scaled to sum to 100, because that is what a `PanelGroup` expects of its `defaultSize`s. */
export function normalizeSizes(sizes: readonly number[]): readonly number[] {
  const total = sizes.reduce((sum, size) => sum + Math.max(0, size), 0);
  if (total <= 0) return sizes.map(() => 100 / sizes.length);
  return sizes.map((size) => (Math.max(0, size) / total) * 100);
}

/**
 * Runs `transform` over a branch's children and puts the branch back together, healing it: a branch
 * left with one child collapses into it, and one left with none disappears in turn — otherwise
 * closing tabs builds a tower of single-child splits that each still eat a resize handle. The
 * branch itself comes back by reference when no child moved.
 */
export function rebuildBranch(
  node: PaneBranch,
  transform: (child: PaneNode) => PaneNode | null,
): PaneNode | null {
  let changed = false;
  const children: PaneNode[] = [];
  const sizes: number[] = [];

  node.children.forEach((child, index) => {
    const next = transform(child);
    if (next !== child) changed = true;
    if (next) {
      children.push(next);
      sizes.push(node.sizes[index] ?? 0);
    }
  });

  if (!changed) return node;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...node, children, sizes: normalizeSizes(sizes) };
}

/** Swaps one node for another, or removes it when `next` is null. */
export function replaceNode(node: PaneNode, id: string, next: PaneNode | null): PaneNode | null {
  if (node.id === id) return next;
  if (isGroup(node)) return node;
  return rebuildBranch(node, (child) => replaceNode(child, id, next));
}

/**
 * Puts `fresh` beside `hostId`, splitting `share` percent of the host's space off for it.
 *
 * Not simply "wrap the host in a new branch": a third pane dropped right of two side-by-side panes
 * should make a row of three, not a row containing a row. One flat branch also resizes the way the
 * eye expects.
 */
export function insertBeside(
  node: PaneNode,
  hostId: string,
  fresh: PaneNode,
  direction: PaneBranch["direction"],
  before: boolean,
  share: number,
): PaneNode {
  if (node.id === hostId) {
    return {
      kind: "branch",
      id: newId("branch"),
      direction,
      children: before ? [fresh, node] : [node, fresh],
      sizes: before ? [share, 100 - share] : [100 - share, share],
    };
  }

  if (isGroup(node)) return node;

  const at = node.children.findIndex((child) => child.id === hostId);
  if (at >= 0 && node.direction === direction) {
    const whole = node.sizes[at] ?? 100 / node.children.length;
    const children = [...node.children];
    const sizes = [...node.sizes];
    sizes[at] = whole * (1 - share / 100);
    const index = before ? at : at + 1;
    children.splice(index, 0, fresh);
    sizes.splice(index, 0, whole * (share / 100));
    return { ...node, children, sizes: normalizeSizes(sizes) };
  }

  let changed = false;
  const children = node.children.map((child) => {
    const replaced = insertBeside(child, hostId, fresh, direction, before, share);
    if (replaced !== child) changed = true;
    return replaced;
  });
  return changed ? { ...node, children } : node;
}

/** Keeps `focusedGroup` pointing at a group that still exists. */
export function withFocus(root: PaneNode, preferred: string): EditorLayout {
  const focusedGroup = findGroup(root, preferred) ? preferred : (groups(root)[0]?.id ?? ROOT_GROUP);
  return { root, focusedGroup };
}
