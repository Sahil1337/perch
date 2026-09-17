// The four string helpers every sentence in this folder is built out of, and the two files outside
// it — `program.ts` and `terminus.ts` — that write labels in the same voice.

/** SQL as it will be read, not as it was typed: newlines and runs of spaces collapsed to one. */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The narrator's own quoting convention, which these sentences are read alongside. */
export const code = (text: string): string => `\`${oneLine(text)}\``;

export function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * A fragment of the user's SQL cut to fit where it is going.
 *
 * `max` is the caller's, because the two places that need this are sized by different things: a
 * chapter label sits in a strip, a terminus title sits on one line of a card. Both cut at
 * `max - 1` and spend the last character on the ellipsis, so neither ever renders wider than it
 * asked for.
 */
export function clip(text: string, max: number): string {
  const one = oneLine(text);
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
