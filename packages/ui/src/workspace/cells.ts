// Notebook cells.
//
// A notebook is a plain .sql file — there is no second format and nothing new on the wire. How it
// divides into cells depends on the file itself:
//
//   no `-- %%` in the file  →  every statement is a cell, using the same splitter the server runs,
//                              so an ordinary .sql file opens as a notebook with no ceremony.
//   `-- %%` present         →  the markers are the boundaries. Needed for a cell holding
//                              `begin; … ; commit;`, for a statement with no trailing semicolon,
//                              and for prose cells, which statement mode cannot express because a
//                              comment-only chunk is not a statement.
//
// The file stays valid SQL either way: it runs in psql and opens in any editor.

import { splitStatements } from "@perch/sql";

/** Written at the start of its own line. Everything after it on that line is ignored. */
export const CELL_MARKER = "-- %%";

const MARKER_LINE = /^[ \t]*--[ \t]*%%.*$/gm;

export type Cell = {
  /**
   * Identity for keying results. Combines position with a hash of the text, so editing a cell
   * drops its stale output rather than showing a result the SQL no longer produces.
   */
  readonly id: string;
  readonly sql: string;
  /** Character offset of `sql[0]` in the file, so an edit can be spliced back in. */
  readonly offset: number;
};

export type CellMode = "markers" | "statements";

export function cellMode(source: string): CellMode {
  MARKER_LINE.lastIndex = 0;
  return MARKER_LINE.test(source) ? "markers" : "statements";
}

/** FNV-1a, 32-bit. Not cryptographic — it only has to change when the text does. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Trims `raw` and returns the remaining span, or null when it holds only whitespace. */
function trimmedSpan(raw: string, offset: number): { sql: string; offset: number } | null {
  const start = raw.length - raw.trimStart().length;
  const end = raw.trimEnd().length;
  if (end <= start) return null;
  return { sql: raw.slice(start, end), offset: offset + start };
}

function markerCells(source: string): { sql: string; offset: number }[] {
  const out: { sql: string; offset: number }[] = [];
  let cursor = 0;

  MARKER_LINE.lastIndex = 0;
  for (let m = MARKER_LINE.exec(source); m !== null; m = MARKER_LINE.exec(source)) {
    const span = trimmedSpan(source.slice(cursor, m.index), cursor);
    if (span) out.push(span);
    // Resume after the marker's newline so the marker itself is never part of a cell.
    cursor = m.index + m[0].length + (source[m.index + m[0].length] === "\n" ? 1 : 0);
  }

  const tail = trimmedSpan(source.slice(cursor), cursor);
  if (tail) out.push(tail);
  return out;
}

/**
 * Splits a file into cells. Always returns at least one cell for a non-empty file; an empty file
 * yields none, which the notebook renders as a single empty cell to type into.
 */
export function parseCells(source: string): readonly Cell[] {
  const raw =
    cellMode(source) === "markers"
      ? markerCells(source)
      : splitStatements(source).map((s) => ({ sql: s.sql, offset: s.offset }));

  return raw.map((cell, index) => ({
    id: `${index}:${hash(cell.sql)}`,
    sql: cell.sql,
    offset: cell.offset,
  }));
}

/** The file with `cell`'s text replaced. Offsets of later cells shift; re-parse after calling. */
export function replaceCell(source: string, cell: Cell, sql: string): string {
  return source.slice(0, cell.offset) + sql + source.slice(cell.offset + cell.sql.length);
}

/** The file with `cell` and its trailing marker removed. */
export function deleteCell(source: string, cell: Cell): string {
  const before = source.slice(0, cell.offset);
  const after = source.slice(cell.offset + cell.sql.length);
  // Drop one leading separator from `after` so removing a middle cell does not leave a blank one.
  const trimmed = after.replace(/^[ \t]*\r?\n(?:[ \t]*--[ \t]*%%.*(?:\r?\n|$))?/, "");
  return before + trimmed;
}

/**
 * The file with an empty cell appended: a new `-- %%` in marker mode, a blank line in statement mode.
 * This writes the separator, not a cell — `parseCells` drops a whitespace-only span, so the empty
 * card that goes with it is the notebook's business until what is typed parses as a cell.
 */
export function appendCell(source: string): string {
  const base = source.trimEnd();
  const separator = cellMode(source) === "markers" ? `\n\n${CELL_MARKER}\n` : "\n\n";
  return base + separator;
}

/** Undoes `appendCell`: the trailing marker, if there is one, and the blank space before it. */
export function dropAppendedCell(source: string): string {
  const withoutMarker = source.replace(/(?:[ \t]*\r?\n)*[ \t]*--[ \t]*%%[ \t]*\r?\n?[ \t\r\n]*$/, "");
  return withoutMarker.trimEnd();
}
