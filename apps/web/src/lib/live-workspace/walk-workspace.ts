import type { FilesApi } from "@perch/client";
import type { FileEntry } from "@perch/protocol";
import { dirName } from "./helpers";

/** Directories the workspace walk will list before it stops. A guard, not a policy. */
const MAX_DIRS = 64;

/**
 * Every `.sql` file under the workspace roots, breadth-first, plus the roots as their own entries
 * spell them.
 *
 * `GET /api/files` lists one directory, so a tree costs a request per directory — hence the cap.
 * The flat result is the shape `FilesList` wants. The roots need re-spelling because the server
 * resolves symlinks when reading a path but not when reporting a root, so a root configured as
 * `/tmp/ws` reports as `/tmp/ws` while its files come back under `/private/tmp/ws`; grouping by the
 * reported spelling would file every entry under a second, synthesised heading.
 */
export async function walkWorkspace(
  files: FilesApi,
  reported: readonly string[],
  signal: AbortSignal,
): Promise<{ entries: FileEntry[]; roots: string[] }> {
  // One unreadable directory is not a failed workspace.
  const list = (dir: string): Promise<FileEntry[]> =>
    files.list(dir, { signal }).catch((): FileEntry[] => []);

  const top = await Promise.all(reported.map(list));
  const roots = reported.map((root, index) => {
    const child = top[index]?.[0];
    return child ? dirName(child.path) : root;
  });

  const entries = top.flat();
  let level = entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path);
  let listed = reported.length;
  while (level.length > 0 && listed < MAX_DIRS) {
    const batch = level.slice(0, MAX_DIRS - listed);
    listed += batch.length;
    const found = (await Promise.all(batch.map(list))).flat();
    entries.push(...found);
    level = found.filter((entry) => entry.kind === "dir").map((entry) => entry.path);
  }
  return { entries, roots };
}
