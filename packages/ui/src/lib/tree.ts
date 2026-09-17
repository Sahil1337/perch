// What every disclosure tree in the app needs: how far in a row sits, and the set of what is open.
// The files panel and the schema tree render different rows from different data but indent them on
// the same grid, so the numbers live here rather than once per tree.

/** Pixels. Indentation is the one row value that depends on data, so it is the one inline value. */
export const INDENT_BASE = 8;
export const INDENT_STEP = 12;

/**
 * Row indentation: the only value here Tailwind cannot hold, because it is a function of the row's
 * depth. It is fed to a `--tree-indent` custom property at each call site so the padding stays a
 * utility class and only the number is inline.
 */
export function indent(depth: number): string {
  return `${INDENT_BASE + depth * INDENT_STEP}px`;
}

/** Adds the key when absent, removes it when present. Returns a new set; never mutates. */
export function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
