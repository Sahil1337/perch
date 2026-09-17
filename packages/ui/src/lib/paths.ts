// Path handling, in one place.
//
// Every path in perch is a path the *server* opens, and the server runs on Windows too, so a path
// may arrive with either separator. A path is never rewritten — it goes back to the server
// verbatim — only split for display. Spreading that rule across call sites is how a Windows path
// bug survives, so it is written once here.

/** Server paths are native, so a Windows server sends backslashes. Split on both. */
const SEPARATORS = /[\\/]/;

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/** The last segment: a file's name, or a folder's own name. */
export function baseName(path: string): string {
  const parts = path.split(SEPARATORS);
  return parts[parts.length - 1] ?? path;
}

/** The containing folder. A root, or a path with no separator, is its own parent. */
export function dirName(path: string): string {
  const cut = lastSeparator(path);
  return cut <= 0 ? path : path.slice(0, cut);
}

/** Joins the way the folder is already spelled, so a Windows path stays a Windows path. */
export function joinPath(folder: string, name: string): string {
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return `${folder.replace(/[\\/]+$/, "")}${separator}${name}`;
}

/** Whether `path` is `root` or sits inside it. Either separator counts. */
export function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  const trimmed = /[/\\]$/.test(root) ? root.slice(0, -1) : root;
  return path.startsWith(`${trimmed}/`) || path.startsWith(`${trimmed}\\`);
}

/** Abbreviates the home prefix, which is noise in a small dialog. */
export function tilde(path: string): string {
  return path
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~");
}
