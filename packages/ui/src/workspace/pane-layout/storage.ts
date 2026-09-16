import { isGroup, normalizeSizes, rebuildBranch, withFocus } from "./tree";
import type { EditorLayout, PaneId, PaneNode } from "./types";

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

  return rebuildBranch(node, (child) => dedupe(child, seen));
}

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
