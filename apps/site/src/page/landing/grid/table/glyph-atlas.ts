import { GRID_FONT, type GridLayout } from "./grid-layout";

const COLUMNS = 32;
/** Room either side of a glyph in its cell, so an overhang is not cut. */
const BLEED = 2;
const WEIGHTS = [400, 640] as const;

/**
 * Every character of the table pre-drawn once, in the grid's ink, at regular and semibold weights.
 * A frame draws text only by copying from here, which costs the same for any glyph.
 */
export class GlyphAtlas {
  private readonly canvas = document.createElement("canvas");
  private cellWidth = 0;
  private cellHeight = 0;
  private boldOffset = 0;
  private key = "";

  get ready(): boolean {
    return this.cellWidth > 0;
  }

  /** Draws the atlas for this layout's font and pixel ratio; a no-op when neither changed. */
  build(chars: readonly string[], layout: GridLayout, ink: string) {
    const key = `${layout.font}/${layout.dpr}/${ink}`;
    if (key === this.key) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    this.key = key;
    this.cellWidth = Math.ceil(layout.charWidth * layout.dpr) + BLEED * 2;
    this.cellHeight = layout.rowPx;
    const rows = Math.ceil(chars.length / COLUMNS);
    this.boldOffset = rows * this.cellHeight;
    this.canvas.width = this.cellWidth * COLUMNS;
    this.canvas.height = this.boldOffset * WEIGHTS.length;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = ink;
    ctx.textBaseline = "middle";
    WEIGHTS.forEach((weight, weightIndex) => {
      ctx.font = `${weight} ${layout.font * layout.dpr}px ${GRID_FONT}`;
      chars.forEach((ch, i) => {
        const x = (i % COLUMNS) * this.cellWidth + BLEED;
        const y = weightIndex * this.boldOffset + Math.floor(i / COLUMNS) * this.cellHeight + this.cellHeight / 2 + 0.5;
        ctx.fillText(ch, x, y);
      });
    });
  }

  dispose() {
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.cellWidth = 0;
    this.key = "";
  }

  /** Draws glyph g with its cell's top-left at device px (x, y). */
  draw(ctx: CanvasRenderingContext2D, g: number, x: number, y: number, bold: boolean) {
    const sx = (g % COLUMNS) * this.cellWidth;
    const sy = Math.floor(g / COLUMNS) * this.cellHeight + (bold ? this.boldOffset : 0);
    ctx.drawImage(this.canvas, sx, sy, this.cellWidth, this.cellHeight, x - BLEED, y, this.cellWidth, this.cellHeight);
  }
}
