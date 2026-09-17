// Column widths are computed, not measured. With only visible rows in the DOM, browser auto-sizing
// would re-fit on every scroll tick and jitter. The widths come from the content in `ch`, over a
// sample of rows, identical for header and body because both are monospace.
//
// Deliberately not a client module: `formatCell` is reused across the workspace, and a pure module
// keeps it out of the client boundary its callers would otherwise inherit.

import type { Cell, ResultColumn } from "@perch/protocol";

/** Fixed, and must stay in step with the `h-7` on a row. Virtualization needs one number. */
export const ROW_HEIGHT = 28;
export const OVERSCAN = 12;

/** Column sizing bounds, in `ch`. A 48ch cap keeps one wide text column from eating the viewport. */
const MIN_WIDTH_CH = 6;
const MAX_WIDTH_CH = 48;
const PADDING_CH = 2;
/** Rows sampled when sizing. Reading all 1000 to size a column is not worth the frame. */
const WIDTH_SAMPLE = 200;

/** A cell as text. `null` is not an empty string and renders muted and italic, never as a blank. */
export function formatCell(value: Cell): string {
  return value === null ? "null" : String(value);
}

/** `grid-template-columns`, sized from the data and stretched to fill. See the header for why. */
export function columnTemplate(
  columns: readonly ResultColumn[],
  rows: readonly (readonly Cell[])[],
): string {
  const sampled = Math.min(rows.length, WIDTH_SAMPLE);

  return columns
    .map((column, index) => {
      // The header shows "name type", so it sets a floor for the column.
      let widest = column.name.length + column.type.length + 1;
      for (let row = 0; row < sampled; row += 1) {
        const length = formatCell(rows[row]?.[index] ?? null).length;
        if (length > widest) widest = length;
      }
      const ch = Math.min(MAX_WIDTH_CH, Math.max(MIN_WIDTH_CH, widest + PADDING_CH));
      // The `ch` is a floor and the same number is the column's share of the surplus, so a wide
      // pane stretches columns in proportion instead of stranding a gap at the right edge.
      return `minmax(${ch}ch, ${ch}fr)`;
    })
    .join(" ");
}
