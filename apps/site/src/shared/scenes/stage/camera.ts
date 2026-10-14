// The camera: a slow zoom and pan of the app inside its window, so a scene still reads in a page
// column or on a phone. The chrome stays put; only the app moves. Ported from the legacy element's
// camera so the two cut the same way: frames open on the editor's left edge or below the topbar,
// never through the sidebar, and the far edge gives way before the start of a line does.

import type { EditorView } from "@codemirror/view";
import { EASE_IN_OUT_CSS } from "../../motion/easing";
import type { FrameSize } from "./window-frame";

/** A region of the app, in its native coordinates, that the camera should hold. */
export type Focus = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Prefer opening the frame here (the editor's left edge) when `keep` still fits. */
  left?: number;
  keep?: number;
  /** Keep the right edge rather than the left when the focus is wider than the view. */
  anchor?: "right";
  /** Zoom no further than the focus's width (and height, unless `cropBottom`) allows. */
  fitWidth?: boolean;
  cropBottom?: boolean;
};

export const CAMERA_MS = 1000;

export class Camera {
  readonly #stage: HTMLElement;
  readonly #size: FrameSize;
  readonly #width: () => number;
  #current = { s: 1, cx: 0, cy: 0 };
  #animation: Animation | null = null;

  /**
   * `stage` is the element moved: positioned, at the app's native size, inside the frame's app
   * area. `width` is the frame's rendered width, which decides how far in to go.
   */
  constructor(stage: HTMLElement, size: FrameSize, width: () => number) {
    this.#stage = stage;
    this.#size = size;
    this.#width = width;
    this.#current = { s: 1, cx: size.width / 2, cy: size.height / 2 };
  }

  get zoomed(): boolean {
    return this.#current.s > 1;
  }

  /** How far in to go: further the smaller the window is drawn, so a popup reads at any width. */
  zoom(): number {
    const width = this.#width() || this.#size.width;
    return Math.min(2.6, Math.max(1.35, 1.35 * Math.sqrt(1100 / width)));
  }

  /** An element's box in the stage's own coordinates, untouched by any transform on the way. */
  box(element: Element): { x: number; y: number; w: number; h: number } {
    const stage = this.#stage.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const k = this.#size.width / (stage.width || this.#size.width);
    return {
      x: (rect.left - stage.left) * k,
      y: (rect.top - stage.top) * k,
      w: rect.width * k,
      h: rect.height * k,
    };
  }

  /** A screen point in the stage's coordinates. */
  point(x: number, y: number): { x: number; y: number } {
    const stage = this.#stage.getBoundingClientRect();
    const k = this.#size.width / (stage.width || this.#size.width);
    return { x: (x - stage.left) * k, y: (y - stage.top) * k };
  }

  /** What to hold while typing: the caret with room to read around it, and the popup if one is open. */
  caretFocus(view: EditorView): Focus | null {
    const head = view.coordsAtPos(view.state.selection.main.head);
    if (!head) return null;
    const caret = this.point(head.left, (head.top + head.bottom) / 2);
    let x1 = caret.x + 260;
    let y1 = caret.y + 110;
    const popup = view.dom.querySelector(".cm-tooltip-autocomplete");
    if (popup) {
      const box = this.box(popup);
      x1 = Math.max(x1, box.x + box.w + 24);
      y1 = Math.max(y1, box.y + Math.min(box.h, 200) + 24);
    }
    // Lines read from their start: open on the editor's left edge whenever the caret still fits.
    const main = this.#stage.querySelector("main");
    return {
      x0: caret.x - 120,
      y0: caret.y - 80,
      x1,
      y1,
      ...(main ? { left: this.box(main).x, keep: caret.x + 60 } : {}),
    };
  }

  /** A notebook card, or its left half (the SQL) or right half (the numbers) when narrow. */
  cardFocus(card: HTMLElement, part: "all" | "left" | "right"): Focus {
    const box = this.box(card);
    const h = card.scrollHeight;
    if (part === "all") {
      return { x0: box.x - 24, y0: box.y - 24, x1: box.x + box.w + 24, y1: box.y + h + 120, fitWidth: true };
    }
    const y0 = box.y - 16;
    const y1 = box.y + h + 16;
    const main = this.#stage.querySelector("main");
    if (part === "left") {
      return { x0: box.x - 16, y0, x1: box.x + 420, y1, ...(main ? { left: this.box(main).x } : {}) };
    }
    // The right half opens on a grid line, the left edge of the result's last column.
    const headers = card.querySelectorAll('[role="columnheader"]');
    const last = headers[headers.length - 1];
    const line = headers.length > 1 && last ? this.box(last).x : box.x + box.w - 420;
    return {
      x0: line,
      y0,
      x1: Math.min(this.#size.width, box.x + box.w + 16),
      y1,
      anchor: "right",
      fitWidth: true,
      cropBottom: true,
    };
  }

  /** Pans only when the focus has left the comfortable middle of the view. */
  follow(focus: Focus | null, duration = 900): void {
    if (!focus) return;
    const { s, cx, cy } = this.#current;
    if (s === 1) return this.to(focus, duration);
    const { width: w, height: h } = this.#size;
    const margin = 24;
    const view = { x0: cx - w / (2 * s), y0: cy - h / (2 * s), x1: cx + w / (2 * s), y1: cy + h / (2 * s) };
    const inside =
      focus.x0 >= view.x0 + margin &&
      focus.x1 <= view.x1 - margin &&
      focus.y0 >= view.y0 + margin &&
      focus.y1 <= view.y1 - margin;
    if (!inside) this.to(focus, duration);
  }

  /** Moves to hold `focus`, or back to the whole window for null. 0 ms jumps. */
  to(focus: Focus | null, duration = CAMERA_MS): void {
    const { width: w, height: h } = this.#size;
    let s = 1;
    let cx = w / 2;
    let cy = h / 2;
    if (focus) {
      const fw = focus.x1 - focus.x0;
      const fh = focus.y1 - focus.y0;
      s = this.zoom();
      if (focus.fitWidth) s = Math.min(s, w / fw, focus.cropBottom ? Infinity : h / fh);
      if (focus.cropBottom) s = Math.min(2.8, w / fw);
      s = Math.max(1, s);
      cx = (focus.x0 + focus.x1) / 2;
      cy = (focus.y0 + focus.y1) / 2;
      if (fw > w / s) cx = focus.anchor === "right" ? focus.x1 - w / (2 * s) : focus.x0 + w / (2 * s);
      if (fh > h / s) cy = focus.y0 + h / (2 * s);
      if (focus.left !== undefined && (focus.keep ?? focus.x1) <= focus.left + w / s) {
        cx = focus.left + w / (2 * s);
      }
      // A frame edge never cuts through the sidebar or the topbar: it lands on the editor's left
      // edge or the top of its tabs, so a crop reads as framing rather than as a broken page.
      const main = this.#stage.querySelector("main");
      const header = this.#stage.querySelector("header");
      const left = cx - w / (2 * s);
      if (main) {
        const edge = this.box(main).x;
        if (left > 0 && left < edge) cx = edge + w / (2 * s);
      }
      // A frame cropped at the side would slice the topbar's row in two, so it starts below it.
      const top = cy - h / (2 * s);
      const cropped = cx - w / (2 * s) > 1;
      if (header) {
        const bottom = this.box(header).y + this.box(header).h;
        if ((top > 0 || cropped) && top < bottom) cy = bottom + h / (2 * s);
        // Nor through the editor's tab strip: whole tabs above the code, or none.
        const strip = main?.querySelector(".h-9");
        if (strip) {
          const box = this.box(strip);
          const at = cy - h / (2 * s);
          if (at > box.y + 1 && at < box.y + box.h) {
            const fits = focus.y1 <= box.y + h / s - 12;
            cy = (fits ? box.y : box.y + box.h) + h / (2 * s);
          }
        }
      }
      cx = Math.min(w - w / (2 * s), Math.max(w / (2 * s), cx));
      cy = Math.min(h - h / (2 * s), Math.max(h / (2 * s), cy));
    }
    this.#current = { s, cx, cy };
    const target =
      s === 1
        ? "none"
        : `translate(${(w / 2 - cx * s).toFixed(2)}px, ${(h / 2 - cy * s).toFixed(2)}px) scale(${s.toFixed(4)})`;
    const stage = this.#stage;
    if ((stage.style.transform || "none") === target) return;
    const from = getComputedStyle(stage).transform;
    this.#animation?.cancel();
    stage.style.transform = target === "none" ? "" : target;
    if (!duration || from === getComputedStyle(stage).transform) return;
    this.#animation = stage.animate(
      [{ transform: from }, { transform: target === "none" ? "matrix(1, 0, 0, 1, 0, 0)" : target }],
      { duration, easing: EASE_IN_OUT_CSS },
    );
  }
}
