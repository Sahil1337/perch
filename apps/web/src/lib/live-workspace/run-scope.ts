// Which folder a run belongs to, and which runs a scope asks for.
//
// The same two rules the server holds (`storage.HistoryQuery.keep` and the `workspace` field on a
// run), expressed again here because the History tab filters the runs it already has in memory
// rather than re-asking for them. Like `@perch/protocol` and `apps/server/protocol`, the pair is
// kept in step by hand: a change to one is a change to both.

import type { HistoryScope, RunRecord } from "@perch/protocol";

/**
 * The workspace root a query belongs to.
 *
 * Empty means global — a run that belongs to no folder. Three things land there: a scratch tab,
 * which has no path at all; a file under perch's own `queries/` directory, which is the workspace
 * perch makes for itself rather than one the user chose; and anything outside every root.
 */
export function workspaceOf(
  path: string | null | undefined,
  roots: readonly string[],
  queriesDir: string | null,
): string {
  if (!path) return "";
  if (queriesDir !== null && isInside(path, queriesDir)) return "";
  // The longest matching root wins, so a folder opened inside another folder claims its own files.
  let best = "";
  for (const root of roots) {
    if (isInside(path, root) && root.length > best.length) best = root;
  }
  return best;
}

/** Whether `path` is `dir` or sits under it, on either separator. */
function isInside(path: string, dir: string): boolean {
  if (dir === "") return false;
  const base = dir.replace(/[/\\]+$/, "");
  return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`);
}

/** Whether a run belongs in a page asked for with this scope. Mirrors the server's filter. */
export function inScope(run: RunRecord, scope: HistoryScope, workspace: string): boolean {
  const runWorkspace = run.workspace ?? "";
  if (scope === "global") return runWorkspace === "";
  // `workspace` means this folder *and* the runs that belong to none: a scratch query is part of
  // what you were doing in this project even though no file holds it.
  if (scope === "workspace") return runWorkspace === "" || runWorkspace === workspace;
  return true;
}
