// Where the cards were left, per connection, database and mode — the two modes produce cards of
// different heights, so a layout made in one would overlap in the other. Read when the view opens
// and written after every drag; absence, a private window or a full store all just mean the auto
// layout. A per-viewer convenience, so localStorage is the right home: see use-panels in the app.

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
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const positions = new Map<string, Point>();
    for (const [table, at] of Object.entries(parsed as Record<string, unknown>)) {
      const point = at as Partial<Point> | null;
      if (point && typeof point.x === "number" && typeof point.y === "number") {
        positions.set(table, { x: point.x, y: point.y });
      }
    }
    return positions;
  } catch {
    return null;
  }
}

export function writePositions(key: string | null, positions: ReadonlyMap<string, Point>): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // Storage full or blocked: the layout simply is not remembered.
  }
}

export function clearPositions(key: string | null): void {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}
