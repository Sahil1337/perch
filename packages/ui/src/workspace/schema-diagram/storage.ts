// Where the cards were left, per connection, database and mode — the two modes produce cards of
// different heights, so a layout made in one would overlap in the other. Read when the view opens
// and written after every drag; absence, a private window or a full store all just mean the auto
// layout. A per-viewer convenience, so localStorage is the right home: see use-panels in the app.

import { readJson, remove, writeJson } from "../../lib/storage";
import type { Point } from "./geometry";

export function storageKey(
  connectionId: string | null,
  database: string | null,
  keysOnly: boolean,
): string | null {
  if (!connectionId || !database) return null;
  return `perch:diagram:${connectionId}:${database}:${keysOnly ? "keys" : "all"}`;
}

export function readPositions(key: string | null): Map<string, Point> | null {
  if (!key) return null;
  return readJson(key, parsePositions, null);
}

/** A card whose coordinates are not two numbers is skipped; the auto layout places it instead. */
function parsePositions(value: unknown): Map<string, Point> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const positions = new Map<string, Point>();
  for (const [table, at] of Object.entries(value as Record<string, unknown>)) {
    const point = at as Partial<Point> | null;
    if (point && typeof point.x === "number" && typeof point.y === "number") {
      positions.set(table, { x: point.x, y: point.y });
    }
  }
  return positions;
}

export function writePositions(key: string | null, positions: ReadonlyMap<string, Point>): void {
  if (key) writeJson(key, Object.fromEntries(positions));
}

export function clearPositions(key: string | null): void {
  if (key) remove(key);
}
