import type { Extent } from "./frames";

/** Below this a band beside the copy is no room to fly in, px. */
const MIN_BAND = 56;
/** Kept between a flight and the copy, px. */
const CLEARANCE = 10;

/** The room the birds have this frame, in viewport px. */
export type FlightRoom = {
  width: number;
  height: number;
  /** The first data row's top: the grid shows nothing above it. */
  body: number;
  /** The copy's extent, from the headline's ink to the bottom of its actions. */
  copyTop: number;
  copyBottom: number;
  /** Px per bird unit at full flight size, before a band fits it. */
  flightScale: number;
  /** Px per bird unit once perched, which is the porcelain bird's size. */
  perchedScale: number;
};

export const flightRoom = (): FlightRoom => ({
  width: 0,
  height: 0,
  body: 0,
  copyTop: 0,
  copyBottom: 0,
  flightScale: 1,
  perchedScale: 1,
});

/** A horizontal band to fly in: its top and bottom, the bird's scale in it, and its origin's y. */
export type Band = { top: number; bottom: number; scale: number; y: number; slack: number };

export const band = (): Band => ({ top: 0, bottom: 0, scale: 1, y: 0, slack: 0 });

/**
 * Fits a bird of this extent into the band above the copy or the one below it, whichever `prefer`
 * names if it has room, else the other, at no more than `scale`. The birds never cross the copy:
 * on a phone it spans the width, so the bands are the only room there is. Returns false when
 * neither band has room.
 */
export function fitBand(room: FlightRoom, extent: Extent, scale: number, prefer: "above" | "below", out: Band): boolean {
  const aboveTop = room.body + 4;
  const aboveBottom = room.copyTop - CLEARANCE;
  const belowTop = room.copyBottom + CLEARANCE;
  const belowBottom = room.height - 4;
  const aboveFits = aboveBottom - aboveTop >= MIN_BAND;
  const belowFits = belowBottom - belowTop >= MIN_BAND;
  if (!aboveFits && !belowFits) return false;
  const above = prefer === "above" ? aboveFits : !belowFits;
  out.top = above ? aboveTop : belowTop;
  out.bottom = above ? aboveBottom : belowBottom;
  const height = out.bottom - out.top;
  const tall = extent.bottom - extent.top;
  out.scale = Math.min(scale, height / tall);
  out.slack = Math.max(0, (height - tall * out.scale) / 2);
  out.y = out.top + height / 2 - ((extent.top + extent.bottom) / 2) * out.scale;
  return true;
}
