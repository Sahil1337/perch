import { clamp } from "../math";
import type { Stack } from "./overlay/slips";
import type { Box } from "./sculpture/view";

/** What the scene is laid out from, all in the stage's px. */
export type Measures = {
  stage: { w: number; h: number };
  /** The page container's content box, across: the composition never leaves it. */
  column: { x: number; w: number };
  /** Where the copy ends: the bottom of its CTA row. */
  copyBottom: number;
  /** The query's box, which is also the width of the column its rows stack in. */
  query: { w: number; h: number };
  /** The sculpture's width over its height. */
  aspect: number;
  /** The bird's length, tail to beak. */
  bird: number;
};

/** The keys on the left under the copy; beside them, the query and, under it, the rows it returns. */
export type SceneLayout = { keys: Box; query: { x: number; y: number }; stack: Stack };

// Air under the CTA row and above the section's bottom edge.
const UNDER_COPY = 40;
const OVER_EDGE = 24;
// Between the keys and the query's column.
const COLUMN_GAP = 40;
// The foreign key's note under the query's last line.
const NOTE = 24;
// The kept rows, one per pitch, and the caption under them.
const SLIP_PITCH = 30;
const CAPTION = 24;
const KEPT = { min: 4, max: 8 };
// How much of the bird's length stands above the back row when it perches there.
const HEADROOM = 0.45;

/**
 * The scene's boxes for one size of the landing. The keys take what height is left under the copy
 * (a short screen gets a smaller sculpture, never one under the CTA) and what width the query's
 * column leaves; the column stands right beside them, so the rows always land next to return. The
 * pair is centred in the room under the copy.
 */
export function arrange(m: Measures): SceneLayout {
  const headroom = m.bird * HEADROOM;
  const top = m.copyBottom + UNDER_COPY;
  const room = Math.max(0, m.stage.h - OVER_EDGE - top - headroom);
  const w = Math.max(0, Math.min(m.column.w - m.query.w - COLUMN_GAP, room * m.aspect));
  const h = w / m.aspect;
  const fits = Math.floor((room - m.query.h - NOTE - CAPTION) / SLIP_PITCH);
  const count = clamp(fits, KEPT.min, KEPT.max);
  const column = m.query.h + NOTE + count * SLIP_PITCH + CAPTION;
  const y = top + headroom + Math.max(0, (room - Math.max(h, column)) / 2);
  const right = m.column.x + w + COLUMN_GAP;
  return {
    keys: { x: m.column.x, y, w, h },
    query: { x: right, y },
    stack: { x: right, y: y + m.query.h + NOTE, gap: SLIP_PITCH, count },
  };
}
