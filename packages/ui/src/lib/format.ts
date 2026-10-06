// Small user-facing formatters shared across surfaces. They live here rather than next to one
// consumer because the app has to say the same number the same way everywhere: a count is a count
// whether the results pane, the command palette or the diagram is the one saying it.

/** `1,000 rows` / `1 row`. Grouped, because an ungrouped row count is a number nobody can read. */
export function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** Wall-clock `HH:MM:SS`. A timestamp the browser cannot parse is shown verbatim rather than as `Invalid Date`. */
export function clockOf(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString("en-GB", { hour12: false });
}

/** Wall-clock `HH:MM`, for "since when" rather than "exactly when". Unparseable input is kept. */
export function minuteOf(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}
