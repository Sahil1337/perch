import type { Point } from "../../../shared/math";
import { foreignKeysAmong } from "./schema";

/**
 * The board the tiles stand on, in its own units: 288 × 176 px under lg, where it fills the piece's
 * box at the narrowest phone, and half as large again from lg. Everything on it scales together, so
 * one set of numbers serves both and a thread keeps its angle.
 */
export const BOARD = { width: 288, height: 176 } as const;

export type Tile = { table: string; place: string; at: Point };

/**
 * Four tables that fit the narrowest box, one chain of the birdwatch schema's keys: a sighting is on
 * a checklist and of a species, a species is in a family. Each tile is centred on a Tailwind
 * fraction of the board; its point is read back from that class, so the two cannot drift.
 */
const PLACES = [
  ["checklists", "left-17/72 top-4/11"],
  ["sightings", "left-55/72 top-4/11"],
  ["species", "left-55/72 top-35/44"],
  ["families", "left-17/72 top-35/44"],
] as const;

function pointOf(place: string): Point {
  const fraction = (side: "left" | "top") => {
    const match = new RegExp(`${side}-(\\d+)/(\\d+)`).exec(place);
    return match ? Number(match[1]) / Number(match[2]) : 0;
  };
  return { x: fraction("left") * BOARD.width, y: fraction("top") * BOARD.height };
}

export const TILES: Tile[] = PLACES.map(([table, place]) => ({ table, place, at: pointOf(place) }));

/** The tile that gets dragged, the one the real scene's tour focuses on. */
export const DRAGGED = "sightings";

/** Where the dragged tile stands before the drag, from its place: crowding checklists, off its column. */
export const DRAG_FROM: Point = { x: -36, y: 6 };

export type Thread = { from: Tile; to: Tile };

const byTable = new Map(TILES.map((tile) => [tile.table, tile]));

export const THREADS: Thread[] = foreignKeysAmong(TILES.map((tile) => tile.table)).flatMap(({ from, to }) => {
  const a = byTable.get(from);
  const b = byTable.get(to);
  return a && b ? [{ from: a, to: b }] : [];
});

/** Whether a tile or thread stays lit when the dragged tile is focused: it touches it. */
export const touchesDragged = (thread: Thread): boolean => thread.from.table === DRAGGED || thread.to.table === DRAGGED;

const focused = new Set(THREADS.filter(touchesDragged).flatMap((thread) => [thread.from.table, thread.to.table]));

export const isLit = (tile: Tile): boolean => tile.table === DRAGGED || focused.has(tile.table);
