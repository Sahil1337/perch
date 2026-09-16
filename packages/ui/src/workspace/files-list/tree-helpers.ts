// The tree is assembled here because the server sends a flat list, and `FileEntry.path` is the whole
// structure. Directories may arrive as entries, arrive after their children, or never arrive, so
// paths are threaded onto a node map keyed by full path and missing directories are synthesised.

import type { FileEntry } from "@perch/protocol";

export type TreeNode = {
  readonly path: string;
  readonly name: string;
  readonly kind: FileEntry["kind"];
  readonly children: TreeNode[];
};

export type Group = { readonly root: string; readonly children: readonly TreeNode[] };

/**
 * The flat listing, re-nested. `FileEntry` carries no parent link, so the path is the structure.
 * Interning nodes by full path makes the walk order-independent: a child arriving before its
 * directory synthesises it, and the real entry later finds the node already there.
 *
 * Grouping is by `roots`, in configured order. An entry no root claims still gets a group keyed by
 * its parent, rather than being silently dropped.
 */
export function buildForest(entries: readonly FileEntry[], roots: readonly string[]): readonly Group[] {
  const buckets = new Map<string, TreeNode[]>();
  const nodes = new Map<string, TreeNode>();

  // Seeded first, so a configured root keeps its heading and empty state when nothing is under it.
  for (const root of roots) buckets.set(root, []);

  const bucket = (key: string): TreeNode[] => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: TreeNode[] = [];
    buckets.set(key, created);
    return created;
  };

  const ensure = (path: string, name: string, kind: FileEntry["kind"], root: string): TreeNode => {
    const existing = nodes.get(path);
    if (existing) return existing;

    const node: TreeNode = { children: [], kind, name, path };
    nodes.set(path, node);

    const parent = parentOf(path);
    if (parent !== "" && parent !== root && isUnder(parent, root)) {
      ensure(parent, baseName(parent), "dir", root).children.push(node);
    } else {
      bucket(root).push(node);
    }
    return node;
  };

  for (const entry of entries) {
    if (entry.path === "") continue;
    // Only what the current roots cover: the listing outlives the roots by a beat, since closing a
    // folder is a settings write whose refreshed listing arrives after.
    const root = roots.find((candidate) => isUnder(entry.path, candidate));
    if (root === undefined) continue;
    // The root's own heading already stands for this path; nesting it under itself is a duplicate.
    if (entry.path === root) continue;
    ensure(entry.path, entry.name === "" ? baseName(entry.path) : entry.name, entry.kind, root);
  }

  return [...buckets].map(([root, children]) => ({ children: sortNodes(children), root }));
}

/** Directories first, then name order — what a file browser has trained everyone to expect. */
function sortNodes(nodes: TreeNode[]): readonly TreeNode[] {
  for (const node of nodes) sortNodes(node.children);
  nodes.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );
  return nodes;
}

/**
 * Paths arrive in the server's native form, and the server runs on Windows too, so a path may use
 * either separator. The path is never rewritten — it goes back to the server verbatim — only split
 * for display.
 */
function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

function parentOf(path: string): string {
  const cut = lastSeparator(path);
  return cut <= 0 ? path.slice(0, cut + 1) || "/" : path.slice(0, cut);
}

function baseName(path: string): string {
  const cut = lastSeparator(path);
  return cut === -1 ? path : path.slice(cut + 1);
}

function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  const trimmed = /[/\\]$/.test(root) ? root.slice(0, -1) : root;
  return path.startsWith(`${trimmed}/`) || path.startsWith(`${trimmed}\\`);
}

/** Pixels. Indentation is the one row value that depends on data, so it is the one inline value. */
const INDENT_BASE = 8;
const INDENT_STEP = 12;

/** Depth-based indent, fed to `--tree-indent` so the padding stays a utility class. */
export function indent(depth: number): string {
  return `${INDENT_BASE + depth * INDENT_STEP}px`;
}

export function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
