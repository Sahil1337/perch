import type { GridLayout } from "./table/grid-layout";

const OUTLINE_ALPHA = 0.5;
/** The outline's width in CSS px once the layer's scale is applied. */
const OUTLINE_WIDTH = 1.25;

/**
 * Where the hand-over has the layer, and how far the grid has become the results pane. The layer is
 * translated by (x, y) and scaled from its top-left; `height` is how much of the table shows, in the
 * canvas's own px. The hand-over writes it; the scene draws from it.
 */
export type Dock = {
  x: number;
  y: number;
  scale: number;
  /** 0..1: the hairline around the table that makes the shrinking grid read as a pane. */
  outline: number;
  height: number;
  /** 0..1: the pane's own surface under the rows, which hides the real pane until it has rows. */
  backing: number;
  surface: string;
  /** 0..1: how far into the pane the grid is. Its rows drift less as it gets there, and stand still docked. */
  progress: number;
  /** 0..1: the real pane's own box, in the canvas's px, covered with its surface while it is still empty. */
  cover: number;
  coverX: number;
  coverY: number;
  coverW: number;
  coverH: number;
};

export const dock = (): Dock => ({
  x: 0,
  y: 0,
  scale: 1,
  outline: 0,
  height: 0,
  backing: 0,
  surface: "transparent",
  progress: 0,
  cover: 0,
  coverX: 0,
  coverY: 0,
  coverW: 0,
  coverH: 0,
});

/** The table's outline, a fixed width after the layer's scale, so the shrinking grid reads as a pane. */
export function drawOutline(ctx: CanvasRenderingContext2D, layout: GridLayout, dock: Dock, ink: string) {
  const { dpr } = layout;
  const line = (dpr / dock.scale) * OUTLINE_WIDTH;
  const height = Math.min(layout.height - layout.top, dock.height) * dpr;
  ctx.globalAlpha = dock.outline * OUTLINE_ALPHA;
  ctx.strokeStyle = ink;
  ctx.lineWidth = line;
  ctx.strokeRect(line / 2, layout.top * dpr + line / 2, ctx.canvas.width - line, height - line);
  ctx.globalAlpha = 1;
}

/**
 * The pane's surface, slid in under everything drawn so far: under the docking table, and over the
 * real pane's box while it is still empty, so its placeholder never shows through the grid.
 */
export function drawBacking(ctx: CanvasRenderingContext2D, layout: GridLayout, dock: Dock) {
  const { dpr } = layout;
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = dock.surface;
  if (dock.backing > 0.01) {
    ctx.globalAlpha = dock.backing;
    ctx.fillRect(0, layout.top * dpr, ctx.canvas.width, Math.min(layout.height - layout.top, dock.height) * dpr);
  }
  if (dock.cover > 0.01 && dock.coverW > 0 && dock.coverH > 0) {
    ctx.globalAlpha = dock.cover;
    ctx.fillRect(dock.coverX * dpr, dock.coverY * dpr, dock.coverW * dpr, dock.coverH * dpr);
  }
  ctx.restore();
}
