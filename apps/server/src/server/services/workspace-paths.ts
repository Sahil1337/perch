// Path policy for the workspace: what the client is allowed to name at all. Every path the client
// sends is funnelled through `resolveWithin` first — it realpaths both the roots and the target so
// `..` segments and symlinks cannot escape the configured workspace directories. Pure policy: no
// file is read or written here.

import { promises as fs } from "node:fs";
import path from "node:path";
import { errnoCode } from "../../util/errno.js";
import { badRequest, forbidden } from "../http/errors.js";

export const SQL_EXT = ".sql";
/** Directories that are never useful in a SQL workspace listing (also skipped by the watcher). */
export const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "target", "__pycache__"]);

export function isSqlFile(name: string): boolean {
  return name.toLowerCase().endsWith(SQL_EXT);
}

export function isHidden(name: string): boolean {
  return name.startsWith(".");
}

/**
 * Realpath as much of `target` as exists, then re-append the missing tail. Lets us check a file
 * that is about to be created while still resolving symlinks in the part that does exist.
 */
export async function realpathOrClosest(target: string): Promise<string> {
  const tail: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length > 0 ? path.join(real, ...tail) : real;
    } catch (err) {
      const code = errnoCode(err);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...tail);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function contains(root: string, candidate: string): boolean {
  return (
    candidate === root || candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
  );
}

/** Realpaths the roots, dropping the ones that do not exist. */
export async function resolveRoots(roots: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    try {
      const real = await fs.realpath(path.resolve(root));
      if (!out.includes(real)) out.push(real);
    } catch {
      /* a workspace that has been deleted simply grants nothing */
    }
  }
  return out;
}

/**
 * Resolves `p` and guarantees it sits inside one of `roots`. Returns the real absolute path.
 * Throws a 403 otherwise — including when there are no roots configured at all.
 */
export async function resolveWithin(roots: readonly string[], p: string): Promise<string> {
  if (typeof p !== "string" || p.length === 0) throw badRequest("path is required");
  if (p.includes("\0")) throw badRequest("invalid path");

  const realRoots = await resolveRoots(roots);
  if (realRoots.length === 0) throw forbidden("no workspace directories are configured");
  const resolved = await realpathOrClosest(p);
  if (!realRoots.some((root) => contains(root, resolved))) {
    throw forbidden(`path is outside the allowed workspaces: ${p}`);
  }
  return resolved;
}

/** Rejects names that would traverse, hide, or land outside `.sql`. Returns the normalised name. */
export function safeFileName(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) throw badRequest("name is required");
  if (trimmed !== path.basename(trimmed) || trimmed === "." || trimmed === "..") {
    throw badRequest("name must not contain path separators");
  }
  if (isHidden(trimmed)) throw badRequest("name must not be hidden");
  const withExt = isSqlFile(trimmed) ? trimmed : trimmed + SQL_EXT;
  if (withExt.includes("\0")) throw badRequest("invalid name");
  return withExt;
}
