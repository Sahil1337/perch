import { clamp, type Point } from "../../math";
import type { CellLight } from "../effects/cell-light";
import { WAKE_COVERAGE, type Wake } from "../effects/wake";
import { columnCentre, type GridLayout, rowTop, slotOf } from "../table/grid-layout";
import type { LiveTable } from "../table/live-table";
import { BOX, type Field, type Frames, sample } from "./frames";

/** Below this a quarter row's coverage does not count as filled by the silhouette. */
const FILLED = 0.45;
/** Below this a cell's total coverage is not lit at all. */
const MIN_COVERAGE = 0.08;
/** The furthest any field reaches from the bird's origin, in bird units. */
const REACH = Math.max(-BOX.left, BOX.left + BOX.width, -BOX.top, BOX.top + BOX.height) * 1.05;

/** A bird of cells at one moment: where it is, its size and pose, and how it lights the grid. */
export type BirdPose = {
  x: number;
  y: number;
  /** Px per bird unit. */
  scale: number;
  /** 1 facing right, -1 left; in between, the silhouette narrows as in a bank. */
  flip: number;
  angle: number;
  /** Two flap frames and the mix between them. */
  a: Field;
  b: Field;
  ab: number;
  glide: number;
  flare: number;
  perch: number;
  intensity: number;
  /** How much of what it leaves scatters; 0 for none. */
  wake: number;
  dir: number;
  /** While condensing, the cells it leaves are drawn in toward this point rather than blown along. */
  pull: Point | null;
  /** The intro's bird, which lands on the headline; any other keeps clear of the copy. */
  landing: boolean;
};

export const birdPose = (frames: Frames, landing: boolean): BirdPose => ({
  x: 0,
  y: 0,
  scale: 1,
  flip: 1,
  angle: 0,
  a: frames.perch,
  b: frames.perch,
  ab: 0,
  glide: 0,
  flare: 0,
  perch: 0,
  intensity: 0,
  wake: 0,
  dir: 1,
  pull: null,
  landing,
});

const out = { a: 0, s: 0 };

/**
 * Samples a bird into the cells' light, a quarter row at a time, so the silhouette reads at four
 * times the row's precision. Cells it covers well are handed to the wake.
 */
export function castBird(
  pose: BirdPose,
  frames: Frames,
  light: CellLight,
  wake: Wake,
  table: LiveTable,
  layout: GridLayout,
  drift: number,
  first: number,
) {
  const { scale: s, x: bx, y: by } = pose;
  const cos = Math.cos(-pose.angle);
  const sin = Math.sin(-pose.angle);
  const r = REACH * s;
  const c0 = clamp(Math.floor((bx - r) / layout.charWidth), 0, layout.cols - 1);
  const c1 = clamp(Math.ceil((bx + r) / layout.charWidth), 0, layout.cols - 1);
  const k0 = Math.max(first, Math.floor((by - r - layout.body + drift) / layout.rowHeight));
  const k1 = Math.min(first + layout.rows, Math.ceil((by + r - layout.body + drift) / layout.rowHeight));
  const flapWeight = 1 - pose.glide - pose.flare - pose.perch;
  const quarter = layout.rowHeight / 4;
  const flipInv = 1 / pose.flip;
  for (let k = k0; k <= k1; k++) {
    const top = rowTop(layout, k, drift);
    if (top + layout.rowHeight <= layout.body) continue;
    const slot = slotOf(layout, k);
    const glyphs = table.row(k);
    for (let c = c0; c <= c1; c++) {
      const px = columnCentre(layout, c) - bx;
      let cover = 0;
      let quarters = 0;
      let shade = 0;
      for (let j = 0; j < 4; j++) {
        const py = top + (j + 0.5) * quarter - by;
        const u = ((px * cos - py * sin) / s) * flipInv;
        const v = (px * sin + py * cos) / s;
        let a = 0;
        let sh = 0;
        if (flapWeight > 0.001) {
          sample(pose.a, u, v, out);
          a += out.a * (1 - pose.ab) * flapWeight;
          sh += out.s * out.a * (1 - pose.ab) * flapWeight;
          sample(pose.b, u, v, out);
          a += out.a * pose.ab * flapWeight;
          sh += out.s * out.a * pose.ab * flapWeight;
        }
        if (pose.glide > 0.001) {
          sample(frames.glide, u, v, out);
          a += out.a * pose.glide;
          sh += out.s * out.a * pose.glide;
        }
        if (pose.flare > 0.001) {
          sample(frames.flare, u, v, out);
          a += out.a * pose.flare;
          sh += out.s * out.a * pose.flare;
        }
        if (pose.perch > 0.001) {
          sample(frames.perch, u, v, out);
          a += out.a * pose.perch;
          sh += out.s * out.a * pose.perch;
        }
        if (a > FILLED) quarters |= 1 << j;
        cover += a;
        shade += sh;
      }
      if (cover < MIN_COVERAGE) continue;
      const coverage = cover / 4;
      const lightness = shade / cover;
      const glyph = Math.min(1, coverage * 1.35) * (0.3 + 0.7 * lightness) * pose.intensity;
      light.bird((k - first) * layout.cols + c, glyph, coverage * pose.intensity, lightness, quarters, pose.landing);
      if (pose.wake > 0 && coverage > WAKE_COVERAGE && glyphs[c]) wake.cover(slot * layout.cols + c, k);
    }
  }
  if (pose.wake > 0) wake.stir(pose.dir, pose.wake, pose.pull);
}
