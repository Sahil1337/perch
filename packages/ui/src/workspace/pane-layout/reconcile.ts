import { openPane } from "./operations";
import {
  findGroup,
  isGroup,
  paneGroup,
  panesOf,
  rebuildBranch,
  replaceNode,
  ROOT_GROUP,
  withFocus,
} from "./tree";
import type { EditorLayout, PaneHome, PaneId, PaneNode } from "./types";

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

function prune(node: PaneNode, allowed: ReadonlySet<PaneId>, keep: string): PaneNode | null {
  if (isGroup(node)) {
    const panes = node.panes.filter((pane) => allowed.has(pane));
    // Empty groups are swept away, except the focused one: it is the "No file open" surface.
    if (panes.length === 0) {
      if (node.id !== keep) return null;
      return node.panes.length === 0 ? node : { ...node, panes, activePane: null };
    }
    if (panes.length === node.panes.length) return node;
    return { ...node, panes, activePane: survivor(node.panes, node.activePane, panes) };
  }

  return rebuildBranch(node, (child) => prune(child, allowed, keep));
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
