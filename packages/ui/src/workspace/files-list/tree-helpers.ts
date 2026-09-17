// The tree is assembled here because the server sends a flat list, and `FileEntry.path` is the whole
// structure. Directories may arrive as entries, arrive after their children, or never arrive, so
// paths are threaded onto a node map keyed by full path and missing directories are synthesised.

import type { FileEntry } from "@perch/protocol";
import { baseName, isUnder } from "../../lib/paths";

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
export function buildForest(
  entries: readonly FileEntry[],
  roots: readonly string[],
): readonly Group[] {
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
 * The containing folder, for the node map. Unlike `dirName`, a path whose only separator is the
 * leading one parents to the root itself rather than to the whole path, which is what keeps
 * `/foo` from becoming its own parent and looping `ensure`.
 */
function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? path.slice(0, cut + 1) || "/" : path.slice(0, cut);
}

export { indent, toggle } from "../../lib/tree";
