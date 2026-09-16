import type { Table } from "@perch/protocol";

// Every card is the same width and its height is a function of its column count, so the layout
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

export type Point = { x: number; y: number };

export function cardHeight(table: Table): number {
  return HEADER_H + BODY_PAD * 2 + Math.max(1, table.columns.length) * ROW_H;
}

/** Vertical centre of a column row inside its card; the header for a column that is not listed. */
export function rowCentre(index: number): number {
  return index < 0 ? HEADER_H / 2 : HEADER_H + BODY_PAD + index * ROW_H + ROW_H / 2;
}
