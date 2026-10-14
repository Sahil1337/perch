import type { GlyphAtlas } from "./glyph-atlas";
import { firstRow, type GridLayout, rowTop, slotOf } from "./grid-layout";
import type { LiveTable } from "./live-table";

/** The grid's resting ink: what every cell shows when nothing lights it. */
export const RESTING_ALPHA = 0.17;
const HAIRLINE_ALPHA = 0.055;
const HEADER_ALPHA = 0.4;
/** The header's rule is drawn this much stronger than a row's. */
const HEADER_RULE = 2.2;

/**
 * The grid at rest: rows pre-rendered into a ring of slots, so a frame copies one strip per row and a
 * row is drawn again only when it scrolls into a slot or a value in it ticks. The header row is a
 * strip of its own, drawn over the rows drifting under it.
 */
export class RestingGrid {
  private readonly sheet = document.createElement("canvas");
  private readonly header = document.createElement("canvas");
  private slotRow = new Int32Array(0);
  private layout: GridLayout | null = null;
  private ink = "";

  constructor(
    private readonly table: LiveTable,
    private readonly atlas: GlyphAtlas,
  ) {}

  resize(layout: GridLayout, ink: string) {
    this.layout = layout;
    this.ink = ink;
    this.sheet.width = Math.round(layout.width * layout.dpr);
    this.sheet.height = layout.slots * layout.rowPx;
    this.slotRow = new Int32Array(layout.slots).fill(Number.MIN_SAFE_INTEGER);
    this.header.width = this.sheet.width;
    this.header.height = layout.rowPx;
    const ctx = this.header.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.header.width, this.header.height);
    ctx.globalAlpha = HEADER_ALPHA;
    for (let c = 0; c < layout.cols; c++) {
      const g = this.table.header[c] ?? 0;
      if (g) this.atlas.draw(ctx, g, layout.xs[c] ?? 0, 0, true);
    }
    this.hairlines(ctx, 0, HEADER_RULE);
  }

  dispose() {
    for (const canvas of [this.sheet, this.header]) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.layout = null;
  }

  /** Row k's values changed: draw it again if it is in its slot. */
  invalidate(k: number) {
    const layout = this.layout;
    if (layout && this.slotRow[slotOf(layout, k)] === k) this.render(layout, k);
  }

  drawRows(ctx: CanvasRenderingContext2D, drift: number) {
    const layout = this.layout;
    if (!layout) return;
    const first = firstRow(layout, drift);
    const h = layout.rowPx;
    for (let k = first; k <= first + layout.rows; k++) {
      const slot = slotOf(layout, k);
      if (this.slotRow[slot] !== k) this.render(layout, k);
      const y = Math.round(rowTop(layout, k, drift) * layout.dpr);
      ctx.drawImage(this.sheet, 0, slot * h, this.sheet.width, h, 0, y, this.sheet.width, h);
    }
  }

  drawHeader(ctx: CanvasRenderingContext2D) {
    const layout = this.layout;
    if (layout) ctx.drawImage(this.header, 0, Math.round(layout.top * layout.dpr));
  }

  private render(layout: GridLayout, k: number) {
    const ctx = this.sheet.getContext("2d");
    if (!ctx) return;
    const slot = slotOf(layout, k);
    const y = slot * layout.rowPx;
    ctx.clearRect(0, y, this.sheet.width, layout.rowPx);
    const glyphs = this.table.row(k);
    ctx.globalAlpha = RESTING_ALPHA;
    for (let c = 0; c < layout.cols; c++) {
      const g = glyphs[c] ?? 0;
      if (g) this.atlas.draw(ctx, g, layout.xs[c] ?? 0, y, false);
    }
    this.hairlines(ctx, y, 1);
    this.slotRow[slot] = k;
  }

  /** The column rules through the padding gaps, and the rule under the row. */
  private hairlines(ctx: CanvasRenderingContext2D, y: number, strength: number) {
    const layout = this.layout;
    if (!layout) return;
    const line = Math.max(1, Math.round(layout.dpr * 0.5));
    ctx.globalAlpha = HAIRLINE_ALPHA * strength;
    ctx.fillStyle = this.ink;
    for (const start of this.table.data.starts) {
      if (start === 0 || start > layout.cols) continue;
      ctx.fillRect(layout.xs[start] ?? 0, y, line, layout.rowPx);
    }
    ctx.fillRect(0, y + layout.rowPx - line, ctx.canvas.width, line);
    ctx.globalAlpha = 1;
  }
}
