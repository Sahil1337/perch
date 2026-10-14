import type { CopyZone } from "../copy/copy-zone";
import type { GlyphAtlas } from "../table/glyph-atlas";
import { type GridLayout, rowTop, slotOf } from "../table/grid-layout";
import type { LiveTable } from "../table/live-table";
import { RESTING_ALPHA } from "../table/resting-grid";

const CAPACITY = 900;
/** How long a scrambling value cycles through other characters, as a share of its flight. */
const SCRAMBLE_SHARE = 0.25;
/** Characters per second a scrambling value cycles through. */
const SCRAMBLE_RATE = 10;

/** One scattered value's flight: px it travels sideways and up, its peak brightness, its delay. */
export type Gust = { vx: number; lift: number; alpha: number; delay: number; scramble: boolean };

/**
 * Values knocked out of their cells: each jumps a few px, maybe scrambles, and falls back in like a
 * leaf. Held as a struct of arrays, so a frame allocates nothing. Nothing scatters near the copy.
 */
export class Scatter {
  private count = 0;
  private readonly k = new Int32Array(CAPACITY);
  private readonly c = new Int32Array(CAPACITY);
  private readonly glyph = new Int16Array(CAPACITY);
  private readonly start = new Float32Array(CAPACITY);
  private readonly duration = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly lift = new Float32Array(CAPACITY);
  private readonly alpha = new Float32Array(CAPACITY);
  private readonly seed = new Uint16Array(CAPACITY);
  /** Per ring cell (slot * cols + c): when the value there lands again, so it scatters once at a time. */
  private busyUntil = new Float32Array(0);

  constructor(
    private readonly table: LiveTable,
    private readonly zone: CopyZone,
    private readonly random: () => number,
  ) {}

  resize(ringCells: number) {
    this.busyUntil = new Float32Array(ringCells);
    this.count = 0;
  }

  clear() {
    this.count = 0;
  }

  /** Knocks global row k's value at column c loose, unless it is near the copy or already flying. */
  spawn(layout: GridLayout, first: number, k: number, c: number, now: number, gust: Gust) {
    if (this.count >= CAPACITY || this.nearCopy(layout, first, k, c, gust)) return;
    const key = slotOf(layout, k) * layout.cols + c;
    if ((this.busyUntil[key] ?? 0) > now) return;
    const g = this.table.row(k)[c] ?? 0;
    if (!g) return;
    const i = this.count++;
    const duration = 0.65 + this.random() * 0.45;
    this.k[i] = k;
    this.c[i] = c;
    this.glyph[i] = g;
    this.start[i] = now + gust.delay;
    this.duration[i] = duration;
    this.vx[i] = gust.vx;
    this.lift[i] = gust.lift;
    this.alpha[i] = gust.alpha;
    this.seed[i] = gust.scramble ? 1 + Math.floor(this.random() * 65534) : 0;
    this.busyUntil[key] = now + gust.delay + duration;
  }

  /** Drops the finished, then clears the resting cells under the flying, so each shows once. */
  carve(ctx: CanvasRenderingContext2D, layout: GridLayout, drift: number, first: number, now: number) {
    const quarter = layout.rowHeight / 4;
    let alive = 0;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (let i = 0; i < this.count; i++) {
      const p = (now - (this.start[i] ?? 0)) / (this.duration[i] ?? 1);
      if (p >= 1) continue;
      if (i !== alive) this.move(i, alive);
      alive++;
      const k = this.k[alive - 1] ?? 0;
      if (p < 0 || k < first || k > first + layout.rows) continue;
      const y = rowTop(layout, k, drift);
      if (y < layout.body) continue;
      const c = this.c[alive - 1] ?? 0;
      const x = layout.xs[c] ?? 0;
      ctx.fillRect(x, Math.round((y + quarter * 0.5) * layout.dpr), (layout.xs[c + 1] ?? x) - x, Math.round(quarter * 3 * layout.dpr));
    }
    ctx.restore();
    this.count = alive;
  }

  draw(ctx: CanvasRenderingContext2D, layout: GridLayout, drift: number, first: number, now: number, atlas: GlyphAtlas) {
    const { dpr } = layout;
    for (let i = 0; i < this.count; i++) {
      const p = (now - (this.start[i] ?? 0)) / (this.duration[i] ?? 1);
      const k = this.k[i] ?? 0;
      if (p < 0 || p >= 1 || k < first || k > first + layout.rows) continue;
      const y = rowTop(layout, k, drift);
      if (y < layout.body) continue;
      // Out fast, a drift in the air, then back down into its cell.
      const dx = (this.vx[i] ?? 0) * Math.sin(Math.PI * p ** 0.55);
      const dy = -(this.lift[i] ?? 0) * Math.sin(Math.PI * p ** 0.45);
      const seed = this.seed[i] ?? 0;
      let g = this.glyph[i] ?? 0;
      if (seed && p < SCRAMBLE_SHARE) g = this.table.scramble(g, seed, Math.floor(now * SCRAMBLE_RATE));
      ctx.globalAlpha = RESTING_ALPHA + ((this.alpha[i] ?? 0) - RESTING_ALPHA) * (1 - p) ** 1.3;
      atlas.draw(ctx, g, Math.round((layout.xs[this.c[i] ?? 0] ?? 0) + dx * dpr), Math.round((y + dy) * dpr), false);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Whether the value could come near the copy: any cell between where it rests and where the gust
   * takes it, one cell either side, is in the copy's block.
   */
  private nearCopy(layout: GridLayout, first: number, k: number, c: number, gust: Gust): boolean {
    const mask = this.zone.boxMask;
    const dc = Math.round(gust.vx / layout.charWidth);
    const dk = Math.round(-gust.lift / layout.rowHeight);
    const c0 = Math.max(0, c + Math.min(0, dc) - 1);
    const c1 = Math.min(layout.cols - 1, c + Math.max(0, dc) + 1);
    for (let row = k + Math.min(0, dk) - 1; row <= k + Math.max(0, dk) + 1; row++) {
      const base = (row - first) * layout.cols;
      for (let col = c0; col <= c1; col++) if (mask[base + col]) return true;
    }
    return false;
  }

  private move(from: number, to: number) {
    this.k[to] = this.k[from] ?? 0;
    this.c[to] = this.c[from] ?? 0;
    this.glyph[to] = this.glyph[from] ?? 0;
    this.start[to] = this.start[from] ?? 0;
    this.duration[to] = this.duration[from] ?? 1;
    this.vx[to] = this.vx[from] ?? 0;
    this.lift[to] = this.lift[from] ?? 0;
    this.alpha[to] = this.alpha[from] ?? 0;
    this.seed[to] = this.seed[from] ?? 0;
  }
}
