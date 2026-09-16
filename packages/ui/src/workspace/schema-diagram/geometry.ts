// Every card is the same width and its height is a function of its row count, so the layout
// needs no measurement pass: the classes on the card (`w-64`, `h-8`, `h-6`, `py-1`) are these
// numbers spelled as utilities, and the wires are drawn from the numbers.
export const CARD_W = 256;
export const HEADER_H = 32;
export const ROW_H = 24;
export const BODY_PAD = 4;

/** Horizontal room between layers: the channel the wires run their vertical legs in. */
export const GAP_X = 176;
export const GAP_Y = 48;
/** Between parallel vertical legs sharing a channel. */
export const LANE_GAP = 12;
/** Radius of a wire's corners. */
export const CORNER = 10;
/** How far a wire loops out when it leaves and re-enters the same side. */
export const LOOP_REACH = 32;
/** Between the connected graph and the grid of unconnected tables beneath it. */
export const ORPHAN_GAP = 96;
export const ORPHAN_COLS_MIN = 3;

/** A table wider than this opens the view in keys-only mode. */
export const COLLAPSE_AT = 12;

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Height of a card showing `rows` columns, plus the "N more" / "Keys only" row when it has one. */
export function cardHeight(rows: number, footer: boolean): number {
  return HEADER_H + BODY_PAD * 2 + Math.max(1, rows) * ROW_H + (footer ? ROW_H : 0);
}

/** Vertical centre of a column row inside its card; the header for a column that is not listed. */
export function rowCentre(index: number): number {
  return index < 0 ? HEADER_H / 2 : HEADER_H + BODY_PAD + index * ROW_H + ROW_H / 2;
}
