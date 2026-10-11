export const GRID_FONT = '"Geist Mono Variable", ui-monospace, monospace';

/** The nav's height below lg, the only widths the grid is shown at: the header row sits under it. */
export const NAV_HEIGHT = 56;
/** Row height as a multiple of the font size: a result grid's comfortable density. */
const ROW_LEADING = 1.72;
/** Rows kept rendered beyond the visible ones, so the drift never waits on a fresh row. */
const SPARE_SLOTS = 3;

/** The grid laid out for one viewport. Lengths are CSS px unless named for device px. */
export type GridLayout = {
  width: number;
  height: number;
  dpr: number;
  font: number;
  charWidth: number;
  rowHeight: number;
  /** One row in device px, rounded, so rows tile without seams. */
  rowPx: number;
  /** The top of the header row. */
  top: number;
  /** The top of the first data row: everything above it is the header's. */
  body: number;
  cols: number;
  /** Data rows that can be in view at once. */
  rows: number;
  /** Rows the row sheet holds, as a ring. */
  slots: number;
  /** Device-px x of each character column, so the atlas and the rows agree to the pixel. */
  xs: Float32Array;
};

/** Lays the grid out for the current viewport, `tableWidth` characters wide at most. */
export function layoutGrid(measure: CanvasRenderingContext2D, tableWidth: number): GridLayout {
  const width = innerWidth;
  const height = innerHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const font = width >= 640 ? 12 : 11;
  const rowHeight = Math.round(font * ROW_LEADING);
  measure.font = `400 ${font}px ${GRID_FONT}`;
  const charWidth = measure.measureText("0").width || font * 0.6;
  const cols = Math.min(tableWidth, Math.ceil(width / charWidth) + 1);
  const rows = Math.ceil((height - NAV_HEIGHT) / rowHeight) + 1;
  const xs = new Float32Array(cols + 1);
  for (let c = 0; c <= cols; c++) xs[c] = Math.round(c * charWidth * dpr);
  return {
    width,
    height,
    dpr,
    font,
    charWidth,
    rowHeight,
    rowPx: Math.round(rowHeight * dpr),
    top: NAV_HEIGHT,
    body: NAV_HEIGHT + rowHeight,
    cols,
    rows,
    slots: rows + SPARE_SLOTS,
    xs,
  };
}

/** The top of global row k, in CSS px, with the rows drifted up by `drift`. */
export const rowTop = (layout: GridLayout, k: number, drift: number): number =>
  layout.body + k * layout.rowHeight - drift;

/** The first row in view for this drift. */
export const firstRow = (layout: GridLayout, drift: number): number => Math.floor(drift / layout.rowHeight);

/** Row k's place in the row sheet's ring. */
export const slotOf = (layout: GridLayout, k: number): number => ((k % layout.slots) + layout.slots) % layout.slots;

/** The x of a column's centre, in CSS px. */
export const columnCentre = (layout: GridLayout, c: number): number => (c + 0.5) * layout.charWidth;
