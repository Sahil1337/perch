// The grid and the bird drawn out of it, on one 2D canvas. Nothing here is React: the component
// hands over a canvas and a few callbacks. Every frame is drawn from typed arrays and a glyph atlas,
// so a frame allocates nothing and the cost stays with the cells that actually change.

import { clamp, type Point, seededRandom } from "../math";
import type { CopyParts } from "../types";
import { castBird } from "./bird/cell-bird";
import { flightRoom } from "./bird/flight-room";
import { bakeFrames, extentOf, type Frames } from "./bird/frames";
import { CopyZone, type LayerView } from "./copy/copy-zone";
import type { Headline } from "./copy/headline";
import { dock, drawBacking, drawOutline } from "./dock";
import { CellLight } from "./effects/cell-light";
import { Glints } from "./effects/glints";
import { PointerLight } from "./effects/pointer-light";
import { Ripple, TAP_RADIUS, TAP_REACH } from "./effects/ripple";
import { Scatter } from "./effects/scatter";
import { Wake } from "./effects/wake";
import { GlyphAtlas } from "./table/glyph-atlas";
import { firstRow, type GridLayout, layoutGrid } from "./table/grid-layout";
import { LiveTable } from "./table/live-table";
import { RestingGrid } from "./table/resting-grid";
import { Timeline, type TimelineHooks } from "./timeline";

/** Rows drift up by one about every this many seconds, like a result set still arriving. */
const DRIFT_SECONDS = 3.4;
/** The porcelain bird's arrival sends a ring this far, and no further than this share of the width. */
const ARRIVAL_RADIUS = 380;
const ARRIVAL_REACH = 0.42;
/** The last rows fade into the page from this share of the view's height down. */
const FADE_FROM = 0.8;
const FADE_DEPTH = 0.75;

/** The bird's full flight size, px per bird unit: most of a phone's width, a third of a tablet's. */
const flightScale = (width: number): number => (width < 640 ? width * 0.62 : clamp(width * 0.3, 300, 470));

export type SceneHooks = Omit<TimelineHooks, "arrive"> & {
  /** The porcelain bird's length in px: known before it loads, so the cells can match it. */
  birdLength(): number;
  /** Each animation frame, before the grid is drawn: the hand-over places the layer. */
  frame(): void;
};

export class GridScene {
  readonly dock = dock();
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly frames: Frames;
  /** The perched bird's length in its own units: the porcelain bird's length maps onto it. */
  private readonly perchedLength: number;
  private readonly random = seededRandom(7);
  private readonly table = new LiveTable();
  private readonly atlas = new GlyphAtlas();
  private readonly resting: RestingGrid;
  private readonly zone = new CopyZone();
  private readonly light: CellLight;
  private readonly scatter: Scatter;
  private readonly wake: Wake;
  private readonly ripples: Ripple;
  private readonly pointer = new PointerLight();
  private readonly glints: Glints;
  private readonly timeline: Timeline;
  private readonly room = flightRoom();
  private readonly view: LayerView = { scrollY: 0, x: 0, y: 0, scale: 1 };
  private layout: GridLayout | null = null;
  private fade: CanvasGradient | null = null;
  private ink = "";
  private lit = "";
  private frameId = 0;
  private running = false;
  private last = 0;
  private clock = 0;
  private drift = 0;
  private reduced = false;
  private quiet = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: SceneHooks,
  ) {
    this.ctx = canvas.getContext("2d");
    this.frames = bakeFrames();
    const flying = extentOf([...this.frames.flap, this.frames.glide]);
    const perched = extentOf([this.frames.perch]);
    this.perchedLength = perched.right - perched.left;
    this.resting = new RestingGrid(this.table, this.atlas);
    this.light = new CellLight(this.zone);
    this.scatter = new Scatter(this.table, this.zone, this.random);
    this.wake = new Wake(this.random);
    this.ripples = new Ripple(this.random);
    this.glints = new Glints(this.table, this.resting, this.random);
    this.timeline = new Timeline(this.frames, flying, perched, { ...hooks, arrive: (point) => this.arrive(point) }, this.random);
  }

  get settled(): boolean {
    return this.timeline.settled;
  }

  /** Lays the grid out for the current viewport; call on resize. */
  resize() {
    const ctx = this.ctx;
    if (!ctx) return;
    const layout = layoutGrid(ctx, this.table.data.width);
    this.layout = layout;
    this.canvas.width = Math.round(layout.width * layout.dpr);
    this.canvas.height = Math.round(layout.height * layout.dpr);
    this.ink = this.readColour("--grid-ink");
    this.lit = this.readColour("--grid-lit");
    this.atlas.build(this.table.chars, layout, this.ink);
    this.resting.resize(layout, this.ink);
    const cells = (layout.rows + 2) * layout.cols;
    const ring = layout.slots * layout.cols;
    this.room.flightScale = flightScale(layout.width);
    this.room.perchedScale = this.hooks.birdLength() / this.perchedLength;
    this.zone.resize(cells);
    this.light.resize(cells);
    this.scatter.resize(ring);
    this.wake.resize(ring);
    this.ripples.resize(ring);
    const fadeTop = layout.height * FADE_FROM * layout.dpr;
    this.fade = ctx.createLinearGradient(0, fadeTop, 0, this.canvas.height);
    this.fade.addColorStop(0, "rgba(0,0,0,0)");
    this.fade.addColorStop(1, `rgba(0,0,0,${FADE_DEPTH})`);
    this.draw();
  }

  /** The copy has moved or reflowed: measure what the grid keeps clear of again. */
  measureCopy(parts: CopyParts, headline: Headline) {
    this.zone.measure(parts, headline);
    if (!this.running) this.draw();
  }

  setReduced(on: boolean) {
    this.reduced = on;
    if (on) {
      this.skipIntro();
      this.timeline.calm();
      this.pause();
    }
    this.draw();
  }

  /** While the grid is on its way into the product: no pointer light, no ghost. */
  setQuiet(on: boolean) {
    this.quiet = on;
  }

  setPointer(point: Point | null) {
    this.pointer.set(point);
  }

  /** A tap or click on the grid: a small ring of values scatters from it. */
  ripple(point: Point) {
    if (this.reduced || !this.layout) return;
    this.ripples.start(point, Math.min(TAP_RADIUS, this.layout.width * TAP_REACH), this.clock);
    this.hooks.look(point);
  }

  /** Settles at once: the porcelain bird is placed and the intro is skipped. */
  skipIntro() {
    this.timeline.skip();
    this.scatter.clear();
  }

  /** Draws again after the dock changed, unless the loop is about to anyway. */
  docked() {
    if (!this.running) this.draw();
  }

  play() {
    if (this.running || this.disposed || this.reduced) return;
    this.running = true;
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.loop);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  /** Stops the loop and lets go of every canvas it drew with. */
  destroy() {
    this.pause();
    this.disposed = true;
    this.atlas.dispose();
    this.resting.dispose();
    this.zone.dispose();
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private readonly loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.hooks.frame();
    if (!this.running) return;
    this.step(dt);
    this.draw();
    this.frameId = requestAnimationFrame(this.loop);
  };

  private step(dt: number) {
    const layout = this.layout;
    if (!layout) return;
    this.clock += dt;
    this.drift += ((dt * layout.rowHeight) / DRIFT_SECONDS) * (1 - this.dock.progress);
    this.pointer.step(dt, this.quiet);
    this.updateRoom(layout);
    this.timeline.step(dt, this.clock, this.room, this.quiet);
    this.glints.step(layout, firstRow(layout, this.drift), this.clock);
  }

  /** Where the copy is now, for the flights to keep clear of. */
  private updateRoom(layout: GridLayout) {
    const room = this.room;
    room.width = layout.width;
    room.height = layout.height;
    room.body = layout.body;
    room.copyTop = this.zone.top - scrollY;
    room.copyBottom = this.zone.bottom - scrollY;
  }

  /** The porcelain bird has arrived: a ring spreads from its feet. */
  private arrive(point: Point) {
    if (!this.layout) return;
    this.ripples.start(point, Math.min(ARRIVAL_RADIUS, this.layout.width * ARRIVAL_REACH), this.clock);
  }

  draw() {
    const { ctx, layout } = this;
    if (!ctx || !layout || !this.atlas.ready) return;
    const { dpr } = layout;
    const dock = this.dock;
    const view = this.view;
    view.scrollY = scrollY;
    view.x = dock.x;
    view.y = dock.y;
    view.scale = dock.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.resting.drawRows(ctx, this.drift);
    this.zone.drawVeil(ctx, layout, view);
    // Fade the last rows into the page, and keep the header clear of the rows drifting under it.
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    if (this.fade) {
      ctx.fillStyle = this.fade;
      const fadeTop = Math.round(layout.height * FADE_FROM * dpr);
      ctx.fillRect(0, fadeTop, this.canvas.width, this.canvas.height - fadeTop);
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, Math.round(layout.body * dpr));
    ctx.restore();
    this.resting.drawHeader(ctx);
    if (dock.outline > 0.01) drawOutline(ctx, layout, dock, this.ink);
    if (!this.reduced) this.drawLight(ctx, layout);
    if (dock.backing > 0.01 || dock.cover > 0.01) drawBacking(ctx, layout, dock);
  }

  /** Light: the birds, ripples, the pointer and glints, gathered per cell before anything is drawn. */
  private drawLight(ctx: CanvasRenderingContext2D, layout: GridLayout) {
    const { drift, clock } = this;
    const first = firstRow(layout, drift);
    this.zone.rasterize(layout, drift, this.view);
    const { main, ghost } = this.timeline;
    if (main && main.intensity > 0.01) castBird(main, this.frames, this.light, this.wake, this.table, layout, drift, first);
    if (ghost && ghost.intensity > 0.01) castBird(ghost, this.frames, this.light, this.wake, this.table, layout, drift, first);
    this.wake.release(layout, drift, first, this.scatter, clock);
    this.ripples.cast(this.light, this.scatter, layout, drift, first, clock);
    this.pointer.cast(this.light, layout, drift, first);
    this.glints.cast(this.light, layout, first, clock);
    this.scatter.carve(ctx, layout, drift, first, clock);
    this.light.paint(ctx, layout, drift, first, this.table, this.atlas, this.lit);
    this.scatter.draw(ctx, layout, drift, first, clock, this.atlas);
  }

  private readColour(name: string): string {
    const previous = this.canvas.style.color;
    this.canvas.style.color = `var(${name})`;
    const value = getComputedStyle(this.canvas).color;
    this.canvas.style.color = previous;
    return value;
  }
}
