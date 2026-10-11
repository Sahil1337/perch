import { columnCentre, type GridLayout, rowTop } from "../table/grid-layout";
import type { Gust, Scatter } from "./scatter";

/** The share of the cells a bird has just left that scatter, at full wake. */
const WAKE_SHARE = 0.14;
/** Below this the bird barely covers a cell, and leaving it stirs nothing. */
export const WAKE_COVERAGE = 0.3;

/**
 * Which cells the birds covered last frame, so the ones they have just left can scatter in the
 * direction of flight. While the cell bird condenses, the cells it leaves are drawn in toward it
 * instead. Cells are keyed by their place in the row ring (slot * cols + c).
 */
export class Wake {
  private stamp = new Uint32Array(0);
  private previous = new Int32Array(0);
  private previousRows = new Int32Array(0);
  private previousCount = 0;
  private current = new Int32Array(0);
  private currentRows = new Int32Array(0);
  private currentCount = 0;
  private frame = 1;
  private dir = 1;
  private strength = 0;
  private pulling = false;
  private pullX = 0;
  private pullY = 0;
  private readonly gust: Gust = { vx: 0, lift: 0, alpha: 0, delay: 0, scramble: false };

  constructor(private readonly random: () => number) {}

  resize(ringCells: number) {
    this.stamp = new Uint32Array(ringCells);
    this.previous = new Int32Array(ringCells);
    this.previousRows = new Int32Array(ringCells);
    this.current = new Int32Array(ringCells);
    this.currentRows = new Int32Array(ringCells);
    this.previousCount = 0;
    this.currentCount = 0;
  }

  /** A bird covers this ring cell now. */
  cover(key: number, k: number) {
    if (this.stamp[key] === this.frame) return;
    this.stamp[key] = this.frame;
    this.current[this.currentCount] = key;
    this.currentRows[this.currentCount] = k;
    this.currentCount++;
  }

  /** How this frame's birds stir what they leave: flying `dir`, or drawing cells in toward a point. */
  stir(dir: number, strength: number, pull: { x: number; y: number } | null) {
    this.dir = dir;
    this.strength = Math.max(this.strength, strength);
    this.pulling = pull !== null;
    if (pull) {
      this.pullX = pull.x;
      this.pullY = pull.y;
    }
  }

  /** Scatters the cells covered last frame and not this one, then starts the next frame. */
  release(layout: GridLayout, drift: number, first: number, scatter: Scatter, now: number) {
    const gust = this.gust;
    for (let i = 0; i < this.previousCount; i++) {
      const key = this.previous[i] ?? 0;
      if (this.stamp[key] === this.frame || this.random() > this.strength * WAKE_SHARE) continue;
      const k = this.previousRows[i] ?? 0;
      const c = key % layout.cols;
      if (this.pulling) {
        const dx = this.pullX - columnCentre(layout, c);
        const dy = this.pullY - (rowTop(layout, k, drift) + layout.rowHeight / 2);
        const d = Math.hypot(dx, dy) + 1;
        const reach = Math.min(14, d * 0.2);
        gust.vx = (dx / d) * reach;
        gust.lift = (-dy / d) * reach;
        gust.alpha = 0.5;
        gust.delay = 0;
        gust.scramble = false;
      } else {
        gust.vx = this.dir * (1.5 + this.random() * 3) * (layout.width < 640 ? 0.7 : 1);
        gust.lift = 1 + this.random() * 2;
        gust.alpha = 0.24 + 0.1 * this.strength;
        gust.delay = 0.05 + this.random() * 0.2;
        gust.scramble = true;
      }
      scatter.spawn(layout, first, k, c, now, gust);
    }
    const keys = this.previous;
    const rows = this.previousRows;
    this.previous = this.current;
    this.previousRows = this.currentRows;
    this.previousCount = this.currentCount;
    this.current = keys;
    this.currentRows = rows;
    this.currentCount = 0;
    this.strength = 0;
    this.pulling = false;
    this.frame++;
  }
}
