import type { CopyZone } from "../copy/copy-zone";
import type { GlyphAtlas } from "../table/glyph-atlas";
import { type GridLayout, rowTop } from "../table/grid-layout";
import type { LiveTable } from "../table/live-table";
import { RESTING_ALPHA } from "../table/resting-grid";

/** Above this a lit glyph is drawn semibold. */
const BOLD_AT = 0.45;
const GLOW_ALPHA = 0.07;

/**
 * The light on each visible cell this frame: from the birds, the pointer, ripples and glints,
 * gathered first and painted once, so overlapping sources cost one draw per cell. Cells are indexed
 * (k - first) * cols + c, and only the touched ones are painted and reset. The copy zone's masks
 * are applied as light is gathered, so nothing lights under the copy.
 */
export class CellLight {
  private glyph = new Float32Array(0);
  private cover = new Float32Array(0);
  private shade = new Float32Array(0);
  private glowing = new Float32Array(0);
  private bands = new Uint8Array(0);
  private listed = new Uint8Array(0);
  private touched = new Int32Array(0);
  private touchedCount = 0;

  constructor(private readonly zone: CopyZone) {}

  resize(cells: number) {
    this.glyph = new Float32Array(cells);
    this.cover = new Float32Array(cells);
    this.shade = new Float32Array(cells);
    this.glowing = new Float32Array(cells);
    this.bands = new Uint8Array(cells);
    this.listed = new Uint8Array(cells);
    this.touched = new Int32Array(cells);
    this.touchedCount = 0;
  }

  /** Soft light: brightens the glyph and fills the cell faintly. Kept out of the copy's boxes. */
  glow(idx: number, glyph: number, glow: number) {
    if (this.zone.boxMask[idx]) return;
    this.touch(idx);
    if (glyph > (this.glyph[idx] ?? 0)) this.glyph[idx] = glyph;
    if (glow > (this.glowing[idx] ?? 0)) this.glowing[idx] = glow;
  }

  /**
   * A bird over the cell: `quarters` are the quarter rows its silhouette fills. The landing bird
   * may reach into the copy's block, down to the letters' ink; any other bird keeps out.
   */
  bird(idx: number, glyph: number, coverage: number, lightness: number, quarters: number, landing: boolean) {
    const blocked = (landing ? this.zone.inkMask[idx] : this.zone.boxMask[idx]) ?? 0;
    const free = quarters & ~blocked;
    if (blocked && !free) return;
    this.touch(idx);
    if (!blocked && glyph > (this.glyph[idx] ?? 0)) this.glyph[idx] = glyph;
    if (coverage > (this.cover[idx] ?? 0)) {
      this.cover[idx] = coverage;
      this.shade[idx] = lightness;
    }
    this.bands[idx] = (this.bands[idx] ?? 0) | free;
  }

  /** Paints the gathered light over the resting grid, then clears it for the next frame. */
  paint(ctx: CanvasRenderingContext2D, layout: GridLayout, drift: number, first: number, table: LiveTable, atlas: GlyphAtlas, lit: string) {
    const { dpr, cols, rowHeight } = layout;
    const quarter = rowHeight / 4;
    ctx.fillStyle = lit;
    for (let i = 0; i < this.touchedCount; i++) {
      const idx = this.touched[i] ?? 0;
      const y = rowTop(layout, first + Math.floor(idx / cols), drift);
      if (y < layout.body) continue;
      const c = idx % cols;
      const x = layout.xs[c] ?? 0;
      const w = (layout.xs[c + 1] ?? x) - x;
      const bands = this.bands[idx] ?? 0;
      if (bands) {
        ctx.globalAlpha = Math.min(1, (this.cover[idx] ?? 0) * 1.25) * (0.14 + 0.3 * (this.shade[idx] ?? 0));
        // Each run of filled quarter rows, top to bottom: the silhouette at four times the row's precision.
        for (let j = 0; j < 4; j++) {
          if (!(bands & (1 << j))) continue;
          let end = j + 1;
          while (end < 4 && bands & (1 << end)) end++;
          ctx.fillRect(x, Math.round((y + j * quarter) * dpr), w, Math.round((end - j) * quarter * dpr));
          j = end;
        }
      }
      const glow = this.glowing[idx] ?? 0;
      if (glow > 0.01) {
        ctx.globalAlpha = glow * GLOW_ALPHA;
        ctx.fillRect(x, Math.round(y * dpr), w, layout.rowPx);
      }
    }
    for (let i = 0; i < this.touchedCount; i++) {
      const idx = this.touched[i] ?? 0;
      const light = this.glyph[idx] ?? 0;
      const k = first + Math.floor(idx / cols);
      const y = rowTop(layout, k, drift);
      if (light > 0.03 && y >= layout.body) {
        const c = idx % cols;
        const g = table.row(k)[c] ?? 0;
        if (g) {
          ctx.globalAlpha = Math.min(1, RESTING_ALPHA * 0.6 + light * 0.95);
          atlas.draw(ctx, g, layout.xs[c] ?? 0, Math.round(y * dpr), light > BOLD_AT);
        }
      }
      this.glyph[idx] = 0;
      this.cover[idx] = 0;
      this.glowing[idx] = 0;
      this.bands[idx] = 0;
      this.listed[idx] = 0;
    }
    this.touchedCount = 0;
    ctx.globalAlpha = 1;
  }

  private touch(idx: number) {
    if (this.listed[idx]) return;
    this.listed[idx] = 1;
    this.touched[this.touchedCount++] = idx;
  }
}
