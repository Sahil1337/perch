import { clamp, type Point } from "../../../../shared/math";
import { columnCentre, type GridLayout, rowTop } from "../table/grid-layout";
import type { CellLight } from "./cell-light";

/** How fast the light follows the pointer coming and going, per second. */
const EASE = 6;

/**
 * The soft light the cells take within reach of a mouse pointer. A touch has no pointer to follow,
 * so the component never sets one for it.
 */
export class PointerLight {
  private x = 0;
  private y = 0;
  private target = 0;
  private mix = 0;

  set(point: Point | null) {
    if (point) {
      this.x = point.x;
      this.y = point.y;
    }
    this.target = point ? 1 : 0;
  }

  /** Eases the light toward the pointer being there or not; off while the grid is quiet. */
  step(dt: number, quiet: boolean) {
    this.mix += (this.target * (quiet ? 0 : 1) - this.mix) * Math.min(1, dt * EASE);
  }

  cast(light: CellLight, layout: GridLayout, drift: number, first: number) {
    if (this.mix < 0.01) return;
    const radius = layout.width < 640 ? 110 : 150;
    const k0 = Math.max(first, Math.floor((this.y - radius - layout.body + drift) / layout.rowHeight));
    const k1 = Math.min(first + layout.rows, Math.ceil((this.y + radius - layout.body + drift) / layout.rowHeight));
    const c0 = clamp(Math.floor((this.x - radius) / layout.charWidth), 0, layout.cols - 1);
    const c1 = clamp(Math.ceil((this.x + radius) / layout.charWidth), 0, layout.cols - 1);
    for (let k = k0; k <= k1; k++) {
      const top = rowTop(layout, k, drift);
      if (top < layout.body) continue;
      const dy = top + layout.rowHeight / 2 - this.y;
      for (let c = c0; c <= c1; c++) {
        const dx = columnCentre(layout, c) - this.x;
        // Rows are taller than columns are wide, so the pool is drawn a little flatter.
        const d = Math.sqrt(dx * dx + dy * dy * 1.2);
        if (d >= radius) continue;
        const f = (1 - d / radius) ** 2 * this.mix;
        light.glow((k - first) * layout.cols + c, f * 0.42, f * 0.55);
      }
    }
  }
}
