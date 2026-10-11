import { clamp, type Point } from "../../math";
import { columnCentre, type GridLayout, rowTop, slotOf } from "../table/grid-layout";
import type { CellLight } from "./cell-light";
import type { Gust, Scatter } from "./scatter";

const SPREAD = 1.2;
const LIFE = 1.3;
/** A tap's ring reaches this far, and no further than this share of the view's width. */
export const TAP_RADIUS = 260;
export const TAP_REACH = 0.3;

/**
 * A ring of light spreading through the values from a point, knocking a few loose as it passes: a
 * tap on the grid, or the porcelain bird's arrival. One at a time; a new one replaces the last.
 */
export class Ripple {
  private at = -Infinity;
  private x = 0;
  private y = 0;
  private radius = 0;
  private id = 0;
  /** Per ring cell: the ripple that last scattered it, so each passes through a cell once. */
  private stamp = new Uint32Array(0);
  private readonly gust: Gust = { vx: 0, lift: 0, alpha: 0, delay: 0, scramble: false };

  constructor(private readonly random: () => number) {}

  resize(ringCells: number) {
    this.stamp = new Uint32Array(ringCells);
  }

  start(point: Point, radius: number, now: number) {
    this.x = point.x;
    this.y = point.y;
    this.radius = radius;
    this.at = now;
    this.id++;
  }

  cast(light: CellLight, scatter: Scatter, layout: GridLayout, drift: number, first: number, now: number) {
    const age = now - this.at;
    if (age < 0 || age > LIFE) return;
    const r = this.radius * (1 - (1 - Math.min(1, age / SPREAD)) ** 2);
    const band = 6 + layout.rowHeight * 0.35;
    const fade = 1 - age / LIFE;
    const { x: cx, y: cy } = this;
    const reach = r + band;
    const k0 = Math.max(first, Math.floor((cy - reach - layout.body + drift) / layout.rowHeight));
    const k1 = Math.min(first + layout.rows, Math.ceil((cy + reach - layout.body + drift) / layout.rowHeight));
    const c0 = clamp(Math.floor((cx - reach) / layout.charWidth), 0, layout.cols - 1);
    const c1 = clamp(Math.ceil((cx + reach) / layout.charWidth), 0, layout.cols - 1);
    for (let k = k0; k <= k1; k++) {
      const top = rowTop(layout, k, drift);
      if (top < layout.body) continue;
      const dy = top + layout.rowHeight / 2 - cy;
      const slot = slotOf(layout, k);
      for (let c = c0; c <= c1; c++) {
        const dx = columnCentre(layout, c) - cx;
        const d = Math.hypot(dx, dy);
        const off = Math.abs(d - r);
        if (off > band) continue;
        const glow = (1 - off / band) * fade;
        light.glow((k - first) * layout.cols + c, glow * 0.34, glow * 0.35);
        const key = slot * layout.cols + c;
        if (off < band * 0.5 && this.stamp[key] !== this.id) {
          this.stamp[key] = this.id;
          if (this.random() < 0.2) {
            const gust = this.gust;
            gust.vx = (dx / (d + 1)) * 3;
            gust.lift = (-dy / (d + 1)) * 3;
            gust.alpha = 0.3 + 0.15 * fade;
            scatter.spawn(layout, first, k, c, now, gust);
          }
        }
      }
    }
  }
}
