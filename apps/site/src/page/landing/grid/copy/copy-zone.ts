import type { CopyParts } from "../../types";
import { firstRow, type GridLayout, rowTop } from "../table/grid-layout";
import type { Headline } from "./headline";

/** Room kept around the copy's ink: nothing lights here, not even the bird. */
const INK_PAD = 4;
/** Over the headline's letters only this much, so the bird stands on them; it covers the rounding of a fill to whole pixels. */
const FOOTING = 1.5;
/** Room kept around the copy's block: only the landing bird may light here, for its feet. */
const BOX_PAD_X = 12;
const BOX_PAD_Y = 8;
/** The veil reaches this much further, and fades over the last of it. */
const VEIL_PAD = 20;
/** The veil is drawn this many times smaller and scaled up, which softens its edges for free. */
const VEIL_SCALE = 8;
/** How much of the resting ink the veil takes away behind the copy. */
const VEIL_STRENGTH = 0.82;
const MAX_RECTS = 24;

/** How the layer is placed in the viewport: translated, then scaled from its top-left. */
export type LayerView = { scrollY: number; x: number; y: number; scale: number };

/** Rects as left, top, right, bottom, in page px (viewport x, page y). */
class RectList {
  readonly data = new Float32Array(MAX_RECTS * 4);
  count = 0;

  add(left: number, top: number, right: number, bottom: number) {
    if (this.count >= MAX_RECTS || right <= left || bottom <= top) return;
    const i = this.count * 4;
    this.data[i] = left;
    this.data[i + 1] = top;
    this.data[i + 2] = right;
    this.data[i + 3] = bottom;
    this.count++;
  }
}

/**
 * Where the landing's copy is, and what the grid keeps away from it. The ink tier is the copy's
 * letters and controls: no light at all. The box tier is the whole copy block, padded: glints,
 * ripples, scattered values, the pointer's light and the ghost keep out, and only the landing
 * bird may reach in, as far as the top of the letter it stands on. Both are measured from the DOM
 * on layout changes and laid onto the visible cells each frame, a quarter row at a time. The veil
 * follows the copy's lines, so the rows behind the words dim and the rest stay as they are.
 */
export class CopyZone {
  /** Per visible cell, the quarter rows each tier blocks, indexed (k - first) * cols + c. */
  inkMask = new Uint8Array(0);
  boxMask = new Uint8Array(0);
  /** The copy's extent in page px, from the headline's first line box to the bottom of the actions. */
  top = 0;
  bottom = 0;
  private readonly ink = new RectList();
  private readonly boxes = new RectList();
  private readonly lines = new RectList();
  private readonly veil = document.createElement("canvas");
  private veilLeft = 0;
  private veilTop = 0;
  private measured = false;

  resize(cells: number) {
    this.inkMask = new Uint8Array(cells);
    this.boxMask = new Uint8Array(cells);
  }

  /** Reads the copy's rects from the DOM: on mount, on resize, and when its fonts arrive. */
  measure(parts: CopyParts, headline: Headline) {
    const root = parts.root.current;
    const lede = parts.lede.current;
    const cta = parts.cta.current;
    this.ink.count = 0;
    this.boxes.count = 0;
    this.lines.count = 0;
    const y = scrollY;
    for (const word of headline.ink) this.ink.add(word.left - INK_PAD, word.top - FOOTING + y, word.right + INK_PAD, word.bottom + INK_PAD + y);
    for (const line of headline.lines) this.lines.add(line.left, line.top + y, line.right, line.bottom + y);
    if (lede) for (const line of textLines(lede)) this.both(line.left, line.top + y, line.right, line.bottom + y);
    for (const control of cta ? Array.from(cta.children) : []) {
      const r = control.getBoundingClientRect();
      this.both(r.left, r.top + y, r.right, r.bottom + y);
    }
    if (root) {
      const r = root.getBoundingClientRect();
      this.boxes.add(r.left - BOX_PAD_X, r.top + y - BOX_PAD_Y, r.right + BOX_PAD_X, r.bottom + y + BOX_PAD_Y);
    }
    this.measured = this.ink.count > 0;
    this.top = Math.min(...headline.lines.map((line) => line.top + y));
    this.bottom = -Infinity;
    for (let i = 0; i < this.ink.count; i++) this.bottom = Math.max(this.bottom, this.ink.data[i * 4 + 3] ?? 0);
    this.paintVeil();
  }

  dispose() {
    this.veil.width = 0;
    this.veil.height = 0;
    this.measured = false;
  }

  /** Lays both tiers onto the cells in view. */
  rasterize(layout: GridLayout, drift: number, view: LayerView) {
    this.inkMask.fill(0);
    this.boxMask.fill(0);
    if (!this.measured) return;
    rasterize(this.ink, this.inkMask, layout, drift, view);
    rasterize(this.boxes, this.boxMask, layout, drift, view);
  }

  /** Dims the resting rows behind the copy, so it reads over them. */
  drawVeil(ctx: CanvasRenderingContext2D, layout: GridLayout, view: LayerView) {
    if (!this.measured || !this.veil.width) return;
    const { dpr } = layout;
    const x = ((this.veilLeft - view.x) / view.scale) * dpr;
    const y = ((this.veilTop - view.scrollY - view.y) / view.scale) * dpr;
    const w = ((this.veil.width * VEIL_SCALE) / view.scale) * dpr;
    const h = ((this.veil.height * VEIL_SCALE) / view.scale) * dpr;
    if (y > ctx.canvas.height || y + h < 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = VEIL_STRENGTH;
    ctx.drawImage(this.veil, x, y, w, h);
    ctx.restore();
  }

  /** A line of the lede or a control: ink, and a line for the veil. */
  private both(left: number, top: number, right: number, bottom: number) {
    this.ink.add(left - INK_PAD, top - INK_PAD, right + INK_PAD, bottom + INK_PAD);
    this.lines.add(left, top, right, bottom);
  }

  private paintVeil() {
    const ctx = this.veil.getContext("2d");
    const list = this.lines;
    if (!ctx || !list.count) return;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < list.count; i++) {
      left = Math.min(left, (list.data[i * 4] ?? 0) - VEIL_PAD);
      top = Math.min(top, (list.data[i * 4 + 1] ?? 0) - VEIL_PAD);
      right = Math.max(right, (list.data[i * 4 + 2] ?? 0) + VEIL_PAD);
      bottom = Math.max(bottom, (list.data[i * 4 + 3] ?? 0) + VEIL_PAD);
    }
    this.veilLeft = left;
    this.veilTop = top;
    this.veil.width = Math.ceil((right - left) / VEIL_SCALE);
    this.veil.height = Math.ceil((bottom - top) / VEIL_SCALE);
    ctx.fillStyle = "#000";
    // The inner rect is solid, the padding a step lighter; scaled up, the steps blend into a fade.
    for (const [pad, alpha] of [
      [VEIL_PAD * 0.5, 0.5],
      [0, 1],
    ] as const) {
      ctx.globalAlpha = alpha;
      for (let i = 0; i < list.count; i++) {
        const x0 = ((list.data[i * 4] ?? 0) - pad - left) / VEIL_SCALE;
        const y0 = ((list.data[i * 4 + 1] ?? 0) - pad - top) / VEIL_SCALE;
        const x1 = ((list.data[i * 4 + 2] ?? 0) + pad - left) / VEIL_SCALE;
        const y1 = ((list.data[i * 4 + 3] ?? 0) + pad - top) / VEIL_SCALE;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
}

/** Marks the quarter rows of each visible cell that a rect overlaps. */
function rasterize(list: RectList, mask: Uint8Array, layout: GridLayout, drift: number, view: LayerView) {
  const first = firstRow(layout, drift);
  const quarter = layout.rowHeight / 4;
  for (let i = 0; i < list.count; i++) {
    const left = ((list.data[i * 4] ?? 0) - view.x) / view.scale;
    const top = ((list.data[i * 4 + 1] ?? 0) - view.scrollY - view.y) / view.scale;
    const right = ((list.data[i * 4 + 2] ?? 0) - view.x) / view.scale;
    const bottom = ((list.data[i * 4 + 3] ?? 0) - view.scrollY - view.y) / view.scale;
    if (bottom <= layout.body || top >= layout.height) continue;
    const k0 = Math.max(first, Math.floor((top - layout.body + drift) / layout.rowHeight));
    const k1 = Math.min(first + layout.rows, Math.floor((bottom - layout.body + drift) / layout.rowHeight));
    const c0 = Math.max(0, Math.floor(left / layout.charWidth));
    const c1 = Math.min(layout.cols - 1, Math.floor(right / layout.charWidth));
    for (let k = k0; k <= k1; k++) {
      const y = rowTop(layout, k, drift);
      let bits = 0;
      for (let j = 0; j < 4; j++) {
        if (y + (j + 1) * quarter > top && y + j * quarter < bottom) bits |= 1 << j;
      }
      if (!bits) continue;
      const row = (k - first) * layout.cols;
      for (let c = c0; c <= c1; c++) mask[row + c] = (mask[row + c] ?? 0) | bits;
    }
  }
}

/** A text element's lines in viewport px, from its line fragments. */
function textLines(el: Element): { left: number; top: number; right: number; bottom: number }[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const lines: { left: number; top: number; right: number; bottom: number }[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 1 || r.height < 1) continue;
    const line = lines.find((candidate) => Math.abs(candidate.top - r.top) < 4);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return lines;
}
