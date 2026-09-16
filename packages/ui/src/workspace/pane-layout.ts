// The editor grid's shape: which panes exist, how they nest, and which has focus. Pure data and
// pure functions — no React, no DOM — so everything here is a transform from one layout to the next.
//
// Three disciplines make that work:
//
//   Identity is the change signal. Every function returns its argument by reference when nothing
//   changed, because `reconcile` runs during render and writes back through an effect.
//   A pane lives in exactly one group, so `groupOf` has one answer.
//   The tree owns structure, not content: a pane is an id, and nothing here imports a component.

/** A leaf of the grid: one editor buffer, or the results surface. */
export type PaneId = string;

/** The results pane. There is only ever one, so its id is a constant rather than a generated one. */
export const RESULTS_PANE: PaneId = "results";

const BUFFER_PREFIX = "buffer:";

export function bufferPaneId(bufferId: string): PaneId {
  return `${BUFFER_PREFIX}${bufferId}`;
}

/** The buffer behind a pane, or null for a pane that is not one (today: the results pane). */
export function paneBufferId(pane: PaneId): string | null {
  return pane.startsWith(BUFFER_PREFIX) ? pane.slice(BUFFER_PREFIX.length) : null;
}

/** A tab strip and the pane it is showing. The only node that holds panes. */
export type PaneGroup = {
  readonly kind: "group";
  readonly id: string;
  readonly panes: readonly PaneId[];
  /** Null only while the group is empty, which is the "No file open" state. */
  readonly activePane: PaneId | null;
};

/** A split. `row` puts its children side by side, `column` stacks them. */
export type PaneBranch = {
  readonly kind: "branch";
  readonly id: string;
  readonly direction: "row" | "column";
  readonly children: readonly PaneNode[];
  /** Percent per child — always `children.length` long, always summing to 100. */
  readonly sizes: readonly number[];
};

export type PaneNode = PaneGroup | PaneBranch;

export type EditorLayout = {
  readonly root: PaneNode;
  /** Where a newly opened buffer lands, and whose active pane the Run/Save hotkeys act on. */
  readonly focusedGroup: string;
};

/** Where a dragged tab is headed: into the group's strip, or against one of its four edges. */
export type DropEdge = "center" | "left" | "right" | "top" | "bottom";

/** Where a pane goes when it reappears after being closed. See `reconcile`. */
export type PaneHome = {
  readonly edge: Exclude<DropEdge, "center">;
  /** Percent of the space it will share with the group it splits. */
  readonly size: number;
};

/** The id an empty tree falls back to. Fixed, so a server render and a client render agree. */
const ROOT_GROUP = "group-root";

/**
 * Random rather than sequential: a layout outlives its session, and a counter restarting at 1 would
 * collide with the "group-3" already in localStorage. Only called from event handlers, so it cannot
 * desync hydration.
 */
function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ----------------------------------------------------------------- build */

export function paneGroup(panes: readonly PaneId[], id = newId("group")): PaneGroup {
  return { kind: "group", id, panes, activePane: panes[panes.length - 1] ?? null };
}

/** One group holding everything — what a layout with no split looks like. */
export function singleGroup(panes: readonly PaneId[] = []): EditorLayout {
  const root = paneGroup(panes, ROOT_GROUP);
  return { root, focusedGroup: root.id };
}

/* ------------------------------------------------------------- traversal */

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

/** The one group holding `pane` — "one answer" is the invariant the whole model rests on. */
export function groupOf(node: PaneNode, pane: PaneId): PaneGroup | undefined {
  return groups(node).find((group) => group.panes.includes(pane));
}

export function panesOf(node: PaneNode): readonly PaneId[] {
  return groups(node).flatMap((group) => group.panes);
}

/* -------------------------------------------------------------- rewrites */

/** Scaled to sum to 100, because that is what a `PanelGroup` expects of its `defaultSize`s. */
function normalizeSizes(sizes: readonly number[]): readonly number[] {
  const total = sizes.reduce((sum, size) => sum + Math.max(0, size), 0);
  if (total <= 0) return sizes.map(() => 100 / sizes.length);
  return sizes.map((size) => (Math.max(0, size) / total) * 100);
}

/**
 * Swaps one node for another, or removes it when `next` is null. Removal heals the tree: a branch
 * left with one child collapses into it, and one left with none disappears in turn — otherwise
 * closing tabs builds a tower of single-child splits that each still eat a resize handle.
 */
function replaceNode(node: PaneNode, id: string, next: PaneNode | null): PaneNode | null {
  if (node.id === id) return next;
  if (isGroup(node)) return node;

  let changed = false;
  const children: PaneNode[] = [];
  const sizes: number[] = [];

  node.children.forEach((child, index) => {
    const replaced = replaceNode(child, id, next);
    if (replaced !== child) changed = true;
    if (replaced) {
      children.push(replaced);
      sizes.push(node.sizes[index] ?? 0);
    }
  });

  if (!changed) return node;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...node, children, sizes: normalizeSizes(sizes) };
}

/**
 * Puts `fresh` beside `hostId`, splitting `share` percent of the host's space off for it.
 *
 * Not simply "wrap the host in a new branch": a third pane dropped right of two side-by-side panes
 * should make a row of three, not a row containing a row. One flat branch also resizes the way the
 * eye expects.
 */
function insertBeside(
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

/** The tab that takes over when the active one closes: the next along, else the previous. */
function neighbour(panes: readonly PaneId[], removed: PaneId): PaneId | null {
  const at = panes.indexOf(removed);
  if (at < 0) return panes[0] ?? null;
  return panes[at + 1] ?? panes[at - 1] ?? null;
}

/**
 * Which tab shows after a prune. Walks outwards from where the old one was, so closing the tab you
 * are looking at reveals its neighbour rather than the front of the strip.
 */
function survivor(
  before: readonly PaneId[],
  active: PaneId | null,
  kept: readonly PaneId[],
): PaneId | null {
  if (kept.length === 0) return null;
  if (active && kept.includes(active)) return active;
  const at = active ? before.indexOf(active) : -1;
  if (at < 0) return kept[0] ?? null;
  for (let i = at + 1; i < before.length; i += 1) {
    const candidate = before[i];
    if (candidate && kept.includes(candidate)) return candidate;
  }
  for (let i = at - 1; i >= 0; i -= 1) {
    const candidate = before[i];
    if (candidate && kept.includes(candidate)) return candidate;
  }
  return kept[0] ?? null;
}

function insertAt(panes: readonly PaneId[], pane: PaneId, index?: number): readonly PaneId[] {
  const next = [...panes];
  next.splice(index === undefined ? next.length : Math.max(0, Math.min(index, next.length)), 0, pane);
  return next;
}

/** Keeps `focusedGroup` pointing at a group that still exists. */
function withFocus(root: PaneNode, preferred: string): EditorLayout {
  const focusedGroup = findGroup(root, preferred) ? preferred : (groups(root)[0]?.id ?? ROOT_GROUP);
  return { root, focusedGroup };
}

/* ------------------------------------------------------------ operations */

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
export function removePane(layout: EditorLayout, pane: PaneId): EditorLayout {
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
      const at = index === undefined ? without.length : Math.max(0, Math.min(index, target.panes.length));
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
  const find = (node: PaneNode): PaneBranch | undefined => {
    if (isGroup(node)) return undefined;
    if (node.id === branchId) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };

  const branch = find(layout.root);
  if (!branch || branch.sizes.length !== sizes.length) return layout;
  // Sub-pixel churn from the resize observer would otherwise write to localStorage on every frame.
  if (branch.sizes.every((size, index) => Math.abs(size - (sizes[index] ?? 0)) < 0.5)) return layout;

  const root = replaceNode(layout.root, branchId, { ...branch, sizes: normalizeSizes(sizes) });
  return root ? { ...layout, root } : layout;
}

/* ------------------------------------------------------------ reconcile */

function prune(node: PaneNode, allowed: ReadonlySet<PaneId>, keep: string): PaneNode | null {
  if (isGroup(node)) {
    const panes = node.panes.filter((pane) => allowed.has(pane));
    // Empty groups are swept away, except the focused one: it is the "No file open" surface.
    if (panes.length === 0) return node.id === keep ? (node.panes.length === 0 ? node : { ...node, panes, activePane: null }) : null;
    if (panes.length === node.panes.length) return node;
    return { ...node, panes, activePane: survivor(node.panes, node.activePane, panes) };
  }

  let changed = false;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const pruned = prune(child, allowed, keep);
    if (pruned !== child) changed = true;
    if (pruned) {
      children.push(pruned);
      sizes.push(node.sizes[index] ?? 0);
    }
  });

  if (!changed) return node;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return { ...node, children, sizes: normalizeSizes(sizes) };
}

/**
 * Brings the tree back in step with the panes that exist, so opening and closing a file never has to
 * carry a layout concern. Panes that vanished are pruned, new ones are appended to the focused
 * group, and a pane with a `home` returns to its edge rather than to a tab beside a query.
 *
 * Returns the layout unchanged, by reference, whenever there was nothing to do.
 */
export function reconcile(
  layout: EditorLayout,
  available: readonly PaneId[],
  homes: Readonly<Record<PaneId, PaneHome>> = {},
): EditorLayout {
  const allowed = new Set(available);
  const pruned = prune(layout.root, allowed, layout.focusedGroup) ?? paneGroup([], ROOT_GROUP);

  let next = withFocus(pruned, layout.focusedGroup);
  const present = new Set(panesOf(next.root));

  for (const pane of available) {
    if (present.has(pane)) continue;
    const home = homes[pane];
    if (home) {
      next = openPane(next, pane, home);
      continue;
    }
    const host = findGroup(next.root, next.focusedGroup);
    if (!host) continue;
    const root = replaceNode(next.root, host.id, {
      ...host,
      panes: [...host.panes, pane],
      activePane: pane,
    });
    if (root) next = { ...next, root };
  }

  if (next.root === layout.root && next.focusedGroup === layout.focusedGroup) return layout;
  return next;
}

/* -------------------------------------------------------------- storage */

/**
 * A layout read back from localStorage, which a user can edit and a release can outgrow. Anything
 * malformed becomes `fallback` rather than an exception during render, so the cost of a bad value
 * is a lost arrangement rather than a blank app.
 */
export function sanitizeLayout(value: unknown, fallback: EditorLayout): EditorLayout {
  const node = (input: unknown): PaneNode | null => {
    if (typeof input !== "object" || input === null) return null;
    const raw = input as Record<string, unknown>;
    if (typeof raw.id !== "string") return null;

    if (raw.kind === "group") {
      if (!Array.isArray(raw.panes) || !raw.panes.every((pane) => typeof pane === "string")) return null;
      const panes = raw.panes as readonly PaneId[];
      const active = typeof raw.activePane === "string" ? raw.activePane : null;
      return {
        kind: "group",
        id: raw.id,
        panes,
        activePane: active && panes.includes(active) ? active : (panes[0] ?? null),
      };
    }

    if (raw.kind !== "branch") return null;
    if (raw.direction !== "row" && raw.direction !== "column") return null;
    if (!Array.isArray(raw.children)) return null;
    const children = raw.children.map(node).filter((child): child is PaneNode => child !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0] ?? null;
    const sizes = Array.isArray(raw.sizes) && raw.sizes.length === children.length
      ? (raw.sizes as unknown[]).map((size) => (typeof size === "number" && size > 0 ? size : 1))
      : children.map(() => 1);
    return { kind: "branch", id: raw.id, direction: raw.direction, children, sizes: normalizeSizes(sizes) };
  };

  if (typeof value !== "object" || value === null) return fallback;
  const raw = value as Record<string, unknown>;
  const root = node(raw.root);
  if (!root) return fallback;

  // A pane in two groups breaks the model's one invariant, so it is repaired here rather than
  // defended against everywhere downstream.
  const unique = dedupe(root, new Set<PaneId>());
  if (!unique) return fallback;

  return withFocus(unique, typeof raw.focusedGroup === "string" ? raw.focusedGroup : "");
}

/** Drops the second and later sightings of a pane, keeping the first. */
function dedupe(node: PaneNode, seen: Set<PaneId>): PaneNode | null {
  if (isGroup(node)) {
    const panes = node.panes.filter((pane) => {
      if (seen.has(pane)) return false;
      seen.add(pane);
      return true;
    });
    if (panes.length === node.panes.length) return node;
    // Emptied by the de-duplication itself; a genuinely empty group is kept by the check above.
    if (panes.length === 0) return null;
    const activePane =
      node.activePane && panes.includes(node.activePane) ? node.activePane : (panes[0] ?? null);
    return { ...node, panes, activePane };
  }

  let changed = false;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const next = dedupe(child, seen);
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
