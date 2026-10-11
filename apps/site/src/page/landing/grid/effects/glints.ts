import type { GridLayout } from "../table/grid-layout";
import type { LiveTable } from "../table/live-table";
import type { RestingGrid } from "../table/resting-grid";
import type { CellLight } from "./cell-light";

const CAPACITY = 8;
const RISE = 0.08;
const LIFE = 1.08;
/** A value ticks every this many seconds, give or take half of `TICK_JITTER`. */
const TICK_EVERY = 0.55;
const TICK_JITTER = 0.7;
/** How often a tick is a count rather than a time. */
const COUNT_SHARE = 0.55;

/**
 * Now and then a value changes in place, as a live result's would, and its cells glint for a
 * moment. Kept in a small fixed ring, so a frame allocates nothing.
 */
export class Glints {
  private readonly k = new Int32Array(CAPACITY);
  private readonly c0 = new Int32Array(CAPACITY);
  private readonly c1 = new Int32Array(CAPACITY);
  private readonly at = new Float32Array(CAPACITY).fill(-Infinity);
  private next = 0;
  private due = 1.2;

  constructor(
    private readonly table: LiveTable,
    private readonly resting: RestingGrid,
    private readonly random: () => number,
  ) {}

  /** Ticks a value in view when one is due. */
  step(layout: GridLayout, first: number, now: number) {
    if (now < this.due) return;
    this.due = now + TICK_EVERY + this.random() * TICK_JITTER;
    const k = first + 1 + Math.floor(this.random() * (layout.rows - 2));
    const span = this.table.tick(k, this.random() < COUNT_SHARE);
    if (!span) return;
    this.resting.invalidate(k);
    const i = this.next;
    this.next = (i + 1) % CAPACITY;
    this.k[i] = span.k;
    this.c0[i] = span.c0;
    this.c1[i] = span.c1;
    this.at[i] = now;
  }

  cast(light: CellLight, layout: GridLayout, first: number, now: number) {
    for (let i = 0; i < CAPACITY; i++) {
      const age = now - (this.at[i] ?? -Infinity);
      const k = this.k[i] ?? 0;
      if (age > LIFE || k < first || k > first + layout.rows) continue;
      const v = age < RISE ? age / RISE : 1 - (age - RISE) / (LIFE - RISE);
      const end = Math.min(this.c1[i] ?? 0, layout.cols);
      for (let c = this.c0[i] ?? 0; c < end; c++) light.glow((k - first) * layout.cols + c, v * 0.6, v * 0.35);
    }
  }
}
