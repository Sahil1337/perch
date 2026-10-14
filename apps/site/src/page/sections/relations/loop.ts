import { type Beat, IN_OUT, track } from "../../materials";
import { BOARD, DRAG_FROM, DRAGGED, isLit, type Point, THREADS, type Thread, TILES, type Tile } from "./board";

const PERIOD = 8400;

// The threads draw in one after another, then the dragged tile lifts, slides and sets down, then the
// view focuses on it; at the end the threads fade, the focus lifts and the tile goes back.
const THREAD_AT = 400;
const THREAD_GAP = 450;
const THREAD_MS = 600;
const LIFT_AT = 2500;
const LIFT_MS = 240;
const SLIDE_AT = LIFT_AT + LIFT_MS;
const SLIDE_MS = 1100;
const SET_AT = SLIDE_AT + SLIDE_MS;
const SET_MS = 260;
const FOCUS_AT = 4500;
const FOCUS_MS = 400;
const RESET_AT = 7000;
const FADE_MS = 400;
const RETURN_AT = RESET_AT + FADE_MS;
const RETURN_MS = 700;

/** How high a tile rises off the board when it is picked up. */
const LIFT_PX = 4;

const shiftOf = (tile: Tile): Point => (tile.table === DRAGGED ? DRAG_FROM : { x: 0, y: 0 });

/** A distance in board units as a length that scales with the board, which is a size container. */
const onBoard = (units: number): string => `${(units / BOARD.width) * 100}cqw`;

const angleOf = (p: Point, q: Point): number => Math.atan2(q.y - p.y, q.x - p.x);

/**
 * A thread's pose about its `from` end, which stands at `at`: turned by `turn` degrees and stretched
 * by `scale` along its own length, so the stroke keeps its width. Every pose has the same functions,
 * so the browser interpolates them term by term: the `from` end travels in a straight line, as the
 * tile under it does. Each thread is its own element, so the compositor moves it, not the main thread.
 */
function pose(thread: Thread, at: Point, turn: number, scale: number): Keyframe {
  const { from, to } = thread;
  const along = (angleOf(from.at, to.at) * 180) / Math.PI;
  return {
    transform: `translate(${onBoard(at.x)}, ${onBoard(at.y)}) rotate(${along + turn}deg) scaleX(${scale}) rotate(${-along}deg) translate(${onBoard(-from.at.x)}, ${onBoard(-from.at.y)})`,
  };
}

/** The pose that puts a thread between its tiles where they stand before the drag. */
function before(thread: Thread): { at: Point; turn: number; scale: number } {
  const { from, to } = thread;
  const a = { x: from.at.x + shiftOf(from).x, y: from.at.y + shiftOf(from).y };
  const b = { x: to.at.x + shiftOf(to).x, y: to.at.y + shiftOf(to).y };
  // The short way round: a thread pointing left crosses atan2's seam, and the long way would sweep it.
  const turn = (((angleOf(a, b) - angleOf(from.at, to.at)) * 180) / Math.PI + 540) % 360 - 180;
  return {
    at: a,
    turn,
    scale: Math.hypot(b.x - a.x, b.y - a.y) / Math.hypot(to.at.x - from.at.x, to.at.y - from.at.y),
  };
}

function threadMotion(el: Element, thread: Thread, index: number): Animation[] {
  const start = before(thread);
  const drawAt = THREAD_AT + index * THREAD_GAP;
  const placed = pose(thread, thread.from.at, 0, 1);
  const moved: Beat[] = [
    [drawAt, pose(thread, start.at, start.turn, 0)],
    [drawAt + THREAD_MS, pose(thread, start.at, start.turn, start.scale)],
    [SLIDE_AT, { ...pose(thread, start.at, start.turn, start.scale), easing: IN_OUT }],
    [SLIDE_AT + SLIDE_MS, placed],
  ];
  return [track(el, PERIOD, moved), track(el, PERIOD, focusBeats(el, 0))];
}

/**
 * A part that dims to its still frame's opacity when the view focuses, from full while the tile is
 * dragged, and at the end goes to `end`: out, for a thread drawn in again next time; lit, for a tile.
 */
function focusBeats(el: Element, end: number): Beat[] {
  const rest = Number(getComputedStyle(el).opacity);
  return [
    [FOCUS_AT, { opacity: 1 }],
    [FOCUS_AT + FOCUS_MS, { opacity: rest }],
    [RESET_AT, { opacity: rest }],
    [RESET_AT + FADE_MS, { opacity: end }],
  ];
}

function dragMotion(tile: Element): Animation[] {
  const away: Keyframe = { transform: `translate(${onBoard(DRAG_FROM.x)}, ${onBoard(DRAG_FROM.y)})` };
  const home: Keyframe = { transform: "translate(0, 0)" };
  const out = [
    track(tile, PERIOD, [
      [SLIDE_AT, { ...away, easing: IN_OUT }],
      [SLIDE_AT + SLIDE_MS, home],
      [RETURN_AT, { ...home, easing: IN_OUT }],
      [RETURN_AT + RETURN_MS, away],
    ]),
  ];
  const key = tile.querySelector("[data-keycap]");
  const shadow = tile.querySelector("[data-keycap-shadow]");
  const down: Keyframe = { transform: "translateY(0)" };
  const up: Keyframe = { transform: `translateY(${-LIFT_PX}px)` };
  // The shadow stays on the board as the tile rises, softer and a little wider.
  const shadowDown: Keyframe = { transform: "translateY(0) scale(1)", opacity: 1 };
  const shadowUp: Keyframe = { transform: `translateY(${LIFT_PX}px) scale(1.06)`, opacity: 0.6 };
  const lift = (lowered: Keyframe, raised: Keyframe): Beat[] => [
    [LIFT_AT, lowered],
    [LIFT_AT + LIFT_MS, raised],
    [SET_AT, raised],
    [SET_AT + SET_MS, lowered],
  ];
  if (key) out.push(track(key, PERIOD, lift(down, up)));
  if (shadow) out.push(track(shadow, PERIOD, lift(shadowDown, shadowUp)));
  return out;
}

/** The piece's loop: threads draw in along the keys, one tile is dragged with its threads, then focus. */
export function relationsLoop(root: HTMLElement): Animation[] {
  const out: Animation[] = [];
  THREADS.forEach((thread, index) => {
    const el = root.querySelector(`[data-thread="${index}"]`);
    if (el) out.push(...threadMotion(el, thread, index));
  });
  for (const tile of TILES) {
    const el = root.querySelector(`[data-tile="${tile.table}"]`);
    if (el && !isLit(tile)) out.push(track(el, PERIOD, focusBeats(el, 1)));
  }
  const dragged = root.querySelector(`[data-tile="${DRAGGED}"]`);
  if (dragged) out.push(...dragMotion(dragged));
  return out;
}
