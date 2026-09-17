// The one value mapping every dialect shares: a driver's JS value → the wire `Cell` the UI can
// render. Dates, buffers and objects become strings, because a grid cell is text.

import { type Cell, type Row } from "@perch/protocol";

/** Everything the UI can put in a cell. Dates/buffers/objects become strings. */
export function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value as Cell;
  if (t === "bigint") return (value as bigint).toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export const toRow = (row: unknown[]): Row => row.map(toCell);
