/** Where the bird stood when the slip opened: its feet, in viewport px, and its length. */
export type Anchor = { x: number; y: number; size: number };

const GAP = 12;
const EDGE = 8;

/** The box the bird's body fills: it stands on its feet, so nearly all of it is above them. */
export function birdBox({ x, y, size }: Anchor) {
  return { left: x - size * 0.55, right: x + size * 0.55, top: y - size * 0.85, bottom: y + size * 0.1 };
}

/** Whether (px, py) is in birdBox for feet at (x, y), without building the box: it runs per move. */
export function inBirdBox(x: number, y: number, size: number, px: number, py: number): boolean {
  return px > x - size * 0.55 && px < x + size * 0.55 && py > y - size * 0.85 && py < y + size * 0.1;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * The slip's top-left corner: beside the bird on the right, else the left, else above it, else
 * below, whichever first keeps all of it in the view and clear of the nav (whose bottom is `top`).
 */
export function placeSlip(anchor: Anchor, w: number, h: number, top: number): { x: number; y: number } {
  const box = birdBox(anchor);
  const minY = top + EDGE;
  const maxY = innerHeight - h - EDGE;
  const besideY = clamp(box.top, minY, maxY);
  const fitsY = h <= innerHeight - minY - EDGE;
  if (fitsY && box.right + GAP + w <= innerWidth - EDGE) return { x: box.right + GAP, y: besideY };
  if (fitsY && box.left - GAP - w >= EDGE) return { x: box.left - GAP - w, y: besideY };
  const x = clamp(anchor.x - w / 2, EDGE, innerWidth - w - EDGE);
  if (box.top - GAP - h >= minY) return { x, y: box.top - GAP - h };
  return { x, y: clamp(box.bottom + GAP, minY, maxY) };
}
