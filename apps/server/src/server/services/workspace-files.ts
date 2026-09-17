// Reading and writing the workspace, once a path has cleared workspace-paths. Nothing here checks
// permissions: callers pass paths that `resolveWithin` has already vouched for.

import { promises as fs, type Dirent, type Stats } from "node:fs";
import path from "node:path";
import type { FileEntry } from "@perch/protocol";
import { writeFileAtomic } from "../../util/atomic-write.js";
import { errnoCode } from "../../util/errno.js";
import { badRequest, notFound } from "../http/errors.js";
import { SKIPPED_DIRS, isHidden, isSqlFile } from "./workspace-paths.js";

/** A 409 carries the file's current text back inline only while it is small enough to be cheap. */
const CONFLICT_CONTENT_LIMIT = 512 * 1024;

/**
 * What the 409 from PUT /api/files/content carries beside its message when the file moved under
 * the client's feet: the file as it is on disk now.
 */
export type StaleWrite = {
  modifiedAt: string | null;
  size?: number;
  content?: string;
};

function toEntry(full: string, stats: Stats, kind: "file" | "dir"): FileEntry {
  const entry: FileEntry = { path: full, name: path.basename(full), kind };
  if (kind === "file") entry.size = stats.size;
  entry.modifiedAt = stats.mtime.toISOString();
  return entry;
}

/** stat + FileEntry for one path. */
export async function entryFor(full: string): Promise<FileEntry> {
  const stats = await fs.stat(full);
  return toEntry(full, stats, stats.isDirectory() ? "dir" : "file");
}

/** Directories and `.sql` files only; hidden entries and symlinks are skipped. Dirs sort first. */
export async function listDir(dir: string): Promise<FileEntry[]> {
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = errnoCode(err);
    if (code === "ENOENT") throw notFound(`no such directory: ${dir}`);
    if (code === "ENOTDIR") throw badRequest(`not a directory: ${dir}`);
    throw err;
  }
  const out: FileEntry[] = [];
  for (const dirent of dirents) {
    if (isHidden(dirent.name) || dirent.isSymbolicLink()) continue;
    const isDir = dirent.isDirectory();
    if (isDir && SKIPPED_DIRS.has(dirent.name)) continue;
    if (!isDir && !(dirent.isFile() && isSqlFile(dirent.name))) continue;
    const full = path.join(dir, dirent.name);
    try {
      out.push(toEntry(full, await fs.stat(full), isDir ? "dir" : "file"));
    } catch {
      /* vanished between readdir and stat */
    }
  }
  out.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );
  return out;
}

export async function readTextFile(full: string): Promise<{ content: string; modifiedAt: string }> {
  const [content, stats] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);
  return { content, modifiedAt: stats.mtime.toISOString() };
}

/** Writes via a temp file + rename and returns the new mtime, the client's next `ifModifiedAt`. */
export async function writeSqlFile(full: string, content: string): Promise<string> {
  await writeFileAtomic(full, content);
  return (await fs.stat(full)).mtime.toISOString();
}

export async function exists(full: string): Promise<boolean> {
  try {
    await fs.stat(full);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guards a write against the file having changed since the client read it. Returns `undefined`
 * when the write may proceed, or what the caller should hang on its 409.
 */
export async function assertNotStale(
  full: string,
  ifModifiedAt: string,
): Promise<StaleWrite | undefined> {
  const entry = (await exists(full)) ? await entryFor(full) : undefined;
  const modifiedAt = entry?.modifiedAt;
  if (modifiedAt === ifModifiedAt) return undefined;

  const conflict: StaleWrite = { modifiedAt: modifiedAt ?? null };
  if (entry) {
    conflict.size = entry.size ?? 0;
    if ((entry.size ?? 0) < CONFLICT_CONTENT_LIMIT) {
      try {
        conflict.content = (await readTextFile(full)).content;
      } catch {
        /* it vanished again between the stat and the read; modifiedAt still tells the story */
      }
    }
  }
  return conflict;
}
