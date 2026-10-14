import { type GridData, gridData, headerLine, lineOf } from "./grid-data";

const DIGITS = "0123456789";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
/** Rows start in early April, where the spring is busiest. */
const FIRST_ROW = 150;
const COUNT_COLUMN = 2;
const SEEN_AT_COLUMN = 4;
const MINUTES_PER_DAY = 24 * 60;

/** A run of cells in one row: a value that just changed. */
export type CellSpan = { k: number; c0: number; c1: number };

/**
 * The result set as glyph ids, one row per global row index, looping over the recorded sightings.
 * Its values tick now and then, as a live result's would; the glyph rows are rebuilt only then.
 */
export class LiveTable {
  readonly data: GridData;
  /** Each distinct character once; a glyph id is an index into it. 0 is the space. */
  readonly chars: string[] = [];
  readonly header: Int16Array;
  /** Glyph ids a scrambling value cycles through: digits for a digit, letters for anything else. */
  readonly digits: Int16Array;
  readonly letters: Int16Array;
  private readonly ids = new Map<string, number>();
  private readonly values: string[][];
  private readonly glyphRows: (Int16Array | undefined)[] = [];
  private readonly isDigit: Uint8Array;

  constructor() {
    this.data = gridData();
    this.values = this.data.values.map((row) => row.slice());
    const header = headerLine(this.data);
    for (const ch of ` ${DIGITS}${LETTERS}…:-.${header}`) this.add(ch);
    for (const row of this.values) for (const value of row) for (const ch of value) this.add(ch);
    this.header = this.glyphsOf(header);
    this.digits = this.glyphsOf(DIGITS);
    this.letters = this.glyphsOf(LETTERS);
    this.isDigit = new Uint8Array(this.chars.length);
    for (const g of this.digits) this.isDigit[g] = 1;
  }

  /** Global row k's glyphs. */
  row(k: number): Int16Array {
    const index = this.indexOf(k);
    const cached = this.glyphRows[index];
    if (cached) return cached;
    const glyphs = this.glyphsOf(lineOf(this.data, this.values[index] ?? []));
    this.glyphRows[index] = glyphs;
    return glyphs;
  }

  /** The glyph a scrambling value shows `step` steps on from `seed`. */
  scramble(g: number, seed: number, step: number): number {
    const pool = this.isDigit[g] ? this.digits : this.letters;
    return pool[(seed + step) % pool.length] ?? g;
  }

  /**
   * Global row k's count goes up by one, or its time by a minute. Returns the cells that changed,
   * or null when the value would outgrow its column or roll past midnight.
   */
  tick(k: number, count: boolean): CellSpan | null {
    const index = this.indexOf(k);
    const row = this.values[index];
    if (!row) return null;
    const column = count ? COUNT_COLUMN : SEEN_AT_COLUMN;
    const next = count ? nextCount(row[column] ?? "") : nextMinute(row[column] ?? "");
    const width = this.data.columns[column]?.width ?? 0;
    if (next === null || next.length > width) return null;
    row[column] = next;
    this.glyphRows[index] = undefined;
    const c0 = (this.data.starts[column] ?? 0) + 1;
    return { k, c0, c1: c0 + width };
  }

  private indexOf(k: number): number {
    const n = this.values.length;
    return (((k + FIRST_ROW) % n) + n) % n;
  }

  private add(ch: string) {
    if (this.ids.has(ch)) return;
    this.ids.set(ch, this.chars.length);
    this.chars.push(ch);
  }

  private glyphsOf(line: string): Int16Array {
    const out = new Int16Array(line.length);
    for (let i = 0; i < line.length; i++) out[i] = this.ids.get(line.charAt(i)) ?? 0;
    return out;
  }
}

function nextCount(value: string): string | null {
  const count = Number(value);
  return Number.isFinite(count) ? String(count + 1) : null;
}

/** "2026-04-05 07:12" → "2026-04-05 07:13". */
function nextMinute(stamp: string): string | null {
  const minutes = Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16)) + 1;
  if (!Number.isFinite(minutes) || minutes >= MINUTES_PER_DAY) return null;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${stamp.slice(0, 11)}${hh}:${mm}`;
}
