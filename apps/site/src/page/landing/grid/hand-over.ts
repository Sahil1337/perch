import type { TryWindow } from "../../hand-over/try-window";
import { clamp, easeInOutQuad, easeStep, smoothstep } from "../../../shared/math";
import type { GridScene } from "./grid-scene";
import { NAV_HEIGHT } from "./table/grid-layout";

/** How fast the layer's opacity and the pane's surface follow their targets, per second. */
const FADE_RATE = 9;
/** How fast the dock's target glides when it moves inside the window, per second. */
const GLIDE_RATE = 12;
/** The grid is quiet (no pointer light, no ghost) once the page has scrolled this share of the view. */
const QUIET_AT = 0.15;

type Rect = { x: number; y: number; w: number; h: number };

/**
 * The scroll hand-over. As the first view scrolls away, the grid's table shrinks, at one scale and
 * clipped to height, onto the real window's results pane. Until the demo has run its query the grid
 * stands in for the pane's rows: it docks on the pane's own surface and holds there, so the pane is
 * never seen empty, then fades to let the real rows show. On a phone the window's camera takes the
 * pane out of view while the query is typed; the grid fades with it. Scroll is never captured: the
 * layer is fixed, and only its transform, clip and opacity follow the page.
 */
export class HandOver {
  private ran = false;
  /** The grid is full-size and fully shown, at the scroll in `scrolled`: nothing to follow. */
  private whole = false;
  private scrolled = -1;
  private opacity = 1;
  private backing = 0;
  private cover = 0;
  private last = 0;
  private surface = "";
  /** Where the pane sits in the window while the camera is out, relative to the window. */
  private readonly rest: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private hasRest = false;
  /** The dock's target, gliding toward `rest` (or the window, before the app has mounted). */
  private readonly target: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private seeded = false;
  /** The whole window, the dock's target before the app inside has mounted. */
  private readonly windowBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** What the layer's style was last given (x, y, scale, clip, opacity), so a still frame writes nothing. */
  private readonly written = new Float64Array(5).fill(NaN);

  constructor(
    private readonly layer: HTMLElement,
    private readonly scene: GridScene,
    private readonly window: Pick<TryWindow, "frame" | "results">,
    private readonly reduced: () => boolean,
  ) {}

  /** The demo has run its query: the pane has rows of its own. */
  setRan(ran: boolean) {
    this.ran = ran;
  }

  /**
   * Places the layer for the current scroll: on scroll and resize (`moved`), and every frame the grid
   * draws, which costs nothing while the page rests at the top with the grid whole.
   */
  update(now: number, moved: boolean) {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    if (!moved && this.whole && scrollY === this.scrolled) return;
    this.scrolled = scrollY;
    const vw = innerWidth;
    const vh = innerHeight;
    const frame = this.window.frame.current?.getBoundingClientRect() ?? null;
    // The grid holds still while the headline scrolls off it and starts to shrink as the window
    // comes up, so the two meet: done when the window's middle is a little above centre.
    const end = frame ? Math.max(vh * 0.5, frame.top + scrollY + frame.height / 2 - vh * 0.55) : vh;
    const begin = Math.max(0, end - vh * 0.85);
    const p = clamp((scrollY - begin) / Math.max(1, end - begin), 0, 1);
    this.scene.setQuiet(scrollY > vh * QUIET_AT);

    if (this.reduced() || !frame) {
      // Under reduced motion the hand-over is a plain fade as the page scrolls.
      this.dock(0, 0, 1, 0, 0, 0);
      this.scene.dock.cover = 0;
      this.place(0, 0, 1, 0, 1 - smoothstep(0.05, 0.6, p));
      return;
    }

    const pane = this.window.results.current;
    const paneRect = pane?.getBoundingClientRect() ?? null;
    const resting = this.track(frame, paneRect, dt);
    if (pane && !this.surface) this.surface = surfaceOf(pane);
    // Until the demo has run, the grid is the pane's rows; once it has, the real ones show through.
    const covering = !this.ran && resting;
    const ease = easeStep(FADE_RATE, dt);
    this.opacity += ((covering ? 1 : 1 - smoothstep(0.7, 1, p)) - this.opacity) * ease;
    this.backing += ((covering ? smoothstep(0.55, 0.92, p) : 0) - this.backing) * ease;
    const paneInView = paneRect !== null && paneRect.bottom > 0 && paneRect.top < vh;
    this.cover += ((covering && paneInView ? 1 : 0) - this.cover) * ease;
    if (this.cover < 0.005) this.cover = 0;
    if (this.opacity < 0.005) this.opacity = 0;
    if (this.opacity > 0.995) this.opacity = 1;
    if (this.backing < 0.005) this.backing = 0;

    const e = easeInOutQuad(p);
    this.whole = e <= 0 && this.opacity === 1 && this.backing === 0 && this.cover === 0;
    if (e <= 0) {
      this.dock(0, 0, 1, 0, 0, 0);
      this.coverPane(frame, paneRect, 0, 0, 1);
      this.place(0, 0, 1, 0, this.opacity);
      return;
    }
    const top = NAV_HEIGHT;
    const tx = frame.left + this.target.x;
    const ty = frame.top + this.target.y;
    const x = tx * e;
    const y = top + (ty - top) * e;
    const w = vw + (this.target.w - vw) * e;
    const h = vh - top + (this.target.h - (vh - top)) * e;
    const s = w / vw;
    const offscreen = y + h < 0 || y > vh;
    this.dock(x, y - top * s, s, smoothstep(0, 0.35, p), h / s, this.backing, e);
    this.coverPane(frame, paneRect, x, y - top * s, s);
    this.place(x, y - top * s, s, Math.max(0, vh - top - h / s), offscreen ? 0 : this.opacity);
  }

  /**
   * Follows where the pane rests in the window, gliding the dock's target there; true while the
   * pane is at rest. The camera moves the pane out of the window's box to frame the editor.
   */
  private track(frame: DOMRect, pane: DOMRect | null, dt: number): boolean {
    const resting =
      pane !== null &&
      pane.left >= frame.left - 1 &&
      pane.top >= frame.top - 1 &&
      pane.right <= frame.right + 1 &&
      pane.bottom <= frame.bottom + 1;
    if (pane && resting) {
      this.rest.x = pane.left - frame.left;
      this.rest.y = pane.top - frame.top;
      this.rest.w = pane.width;
      this.rest.h = pane.height;
      this.hasRest = true;
    }
    this.windowBox.w = frame.width;
    this.windowBox.h = frame.height;
    const goal = this.hasRest ? this.rest : this.windowBox;
    const k = this.seeded ? easeStep(GLIDE_RATE, dt) : 1;
    this.seeded = true;
    this.target.x += (goal.x - this.target.x) * k;
    this.target.y += (goal.y - this.target.y) * k;
    this.target.w += (goal.w - this.target.w) * k;
    this.target.h += (goal.h - this.target.h) * k;
    return pane === null || resting;
  }

  /** The real pane's box, inside the window, in the layer's own px for a layer at (x, y) and scale s. */
  private coverPane(frame: DOMRect, pane: DOMRect | null, x: number, y: number, s: number) {
    const dock = this.scene.dock;
    dock.cover = this.cover;
    if (!pane) return;
    const left = Math.max(pane.left, frame.left);
    const top = Math.max(pane.top, frame.top);
    dock.coverX = (left - x) / s;
    dock.coverY = (top - y) / s;
    dock.coverW = Math.max(0, Math.min(pane.right, frame.right) - left) / s;
    dock.coverH = Math.max(0, Math.min(pane.bottom, frame.bottom) - top) / s;
  }

  private dock(x: number, y: number, scale: number, outline: number, height: number, backing: number, progress = 0) {
    const dock = this.scene.dock;
    dock.progress = progress;
    dock.x = x;
    dock.y = y;
    dock.scale = scale;
    dock.outline = outline;
    dock.height = height;
    dock.backing = backing;
    dock.surface = this.surface || "transparent";
  }

  /**
   * Moves the layer by (x, y) and scales it, clips `clipBottom` px off the table's foot, and writes
   * only what changed. The grid runs only while it can be seen.
   */
  private place(x: number, y: number, scale: number, clipBottom: number, opacity: number) {
    const gone = opacity <= 0 || document.hidden;
    const last = this.written;
    const rx = round(x, 100);
    const ry = round(y, 100);
    const rs = round(scale, 1e4);
    const rc = round(clipBottom, 10);
    const ro = gone ? -1 : round(opacity, 1e3);
    if (rx !== last[0] || ry !== last[1] || rs !== last[2] || rc !== last[3] || ro !== last[4]) {
      last[0] = rx;
      last[1] = ry;
      last[2] = rs;
      last[3] = rc;
      last[4] = ro;
      const style = this.layer.style;
      const moved = rs !== 1 || rx !== 0 || ry !== 0;
      style.transform = moved ? `translate3d(${rx}px, ${ry}px, 0) scale(${rs})` : "";
      style.clipPath = moved ? `inset(${NAV_HEIGHT}px 0 ${rc}px 0)` : "";
      style.opacity = gone || ro >= 1 ? "" : String(ro);
      style.visibility = gone ? "hidden" : "";
      this.scene.docked();
    }
    if (gone) this.scene.pause();
    else this.scene.play();
  }
}

const round = (value: number, steps: number): number => Math.round(value * steps) / steps;

/** The colour the pane paints itself, from the nearest box that has one. */
function surfaceOf(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (colour && colour !== "transparent" && colour !== "rgba(0, 0, 0, 0)") return colour;
  }
  return "";
}
