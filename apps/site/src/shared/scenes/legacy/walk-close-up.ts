import { clamp, easeInOutCubic } from "../../math";
import { REDUCED_MOTION } from "../../viewport/media";
import type { SceneAnchors } from "../types";

// The recording's coordinate space, as walk.js draws it: 1280 wide, a 40px titlebar over 760 of app.
const WIDTH = 1280;
const HEIGHT = 760;
const TITLEBAR = 40;
// The titlebar's scale on a phone: the window still reads as the app around whatever the camera shows.
const CHROME = 0.66;
// The view under the titlebar: 95% of the width, so a phone gets a near-square window. legacy.css
// reserves the same height.
const VIEW_RATIO = 0.95;
const VIEW_MAX = 420;
const MOVE_S = 0.9;

// A framing of the recording: its centre in the app's pixels and the scale it is drawn at, or the
// whole window fitted to the width.
type Shot = { x: number; y: number; scale: number | "fit" };

const WIDE: Shot = { x: WIDTH / 2, y: HEIGHT / 2, scale: "fit" };
// The clause stepper with its first chips, the table's head under it.
const STEPPER: Shot = { x: 80, y: 190, scale: 0.85 };
// The stepper and the table together, for the moment a new clause lights.
const BOTH: Shot = { x: 420, y: 330, scale: 0.5 };
const rows = (x: number): Shot => ({ x, y: 420, scale: 0.8 });
// The first buckets, the big one with its rows.
const GROUPS: Shot = { x: 330, y: 450, scale: 0.7 };
// HAVING's groups and the sorted result, both drawn round x 432.
const LIST: Shot = { x: 432, y: 440, scale: 0.8 };

// When each move starts, in the recording's seconds (data/walk.json has the clause times): wide,
// into the stepper as JOIN lights, down into the rows, and back out to the stepper and table each
// time the next clause lights. Every move takes MOVE_S and every framing holds at least 1.2s.
const SCRIPT: readonly [number, Shot][] = [
  [0, WIDE],
  [1.1, STEPPER],
  [3.2, rows(270)],
  [6.8, BOTH],
  [8.4, rows(330)],
  [15.2, BOTH],
  [16.8, GROUPS],
  [22, BOTH],
  [23.6, LIST],
  [29, BOTH],
  [32.6, LIST],
  [38.6, WIDE],
];
// The poster is the first frame, the source table: reduced motion holds on its rows.
const STILL = rows(270);

type Rect = { left: number; top: number; width: number };

/**
 * Below lg: a camera on <perch-walk>'s recording. The window keeps its titlebar and the clause
 * rail stays under it at the element's width; inside, the recording is framed by the shot SCRIPT
 * gives for the video's own time, so a seek or the loop lands on the right framing at once.
 * Returns the undo.
 */
export function closeUpWalk(host: HTMLElement, anchors: SceneAnchors): () => void {
  const { window: frame, titlebar } = anchors;
  const rail = anchors.rail instanceof HTMLElement ? anchors.rail : null;
  const screen = titlebar.nextElementSibling;
  const video = screen?.querySelector("video");
  const root = frame.getRootNode();
  const element = root instanceof ShadowRoot ? root.host : null;
  if (!(screen instanceof HTMLElement) || !video || !element) return () => {};
  const reduced = matchMedia(REDUCED_MOTION);

  let width = 0;
  let view = 0;
  const rect = ({ x, y, scale }: Shot): Rect => {
    const s = scale === "fit" ? width / WIDTH : Math.max(scale, width / WIDTH);
    const w = width / s;
    const h = view / s;
    // Held to the recording's edges; a view taller than it, as the wide shot is, centres it.
    const left = clamp(x - w / 2, 0, WIDTH - w);
    const top = h >= HEIGHT ? (HEIGHT - h) / 2 : clamp(y - h / 2, 0, HEIGHT - h);
    return { left, top, width: w };
  };
  const at = (time: number): Rect => {
    if (reduced.matches) return rect(STILL);
    let i = 0;
    for (const [index, [start]] of SCRIPT.entries()) if (start <= time) i = index;
    const [start, shot] = SCRIPT[i] ?? [0, WIDE];
    // Into the first shot from the last: the loop ends wide, as it starts.
    const from = rect(SCRIPT[i - 1]?.[1] ?? WIDE);
    const to = rect(shot);
    const t = easeInOutCubic(clamp((time - start) / MOVE_S, 0, 1));
    const mix = (a: number, b: number) => a + (b - a) * t;
    return { left: mix(from.left, to.left), top: mix(from.top, to.top), width: mix(from.width, to.width) };
  };
  const place = () => {
    if (!width) return;
    const { left, top, width: w } = at(video.currentTime);
    const s = width / w;
    video.style.transform = `scale(${s.toFixed(4)}) translate(${(-left).toFixed(1)}px, ${(-top).toFixed(1)}px)`;
  };

  let frameId = 0;
  const run = () => {
    place();
    frameId = video.paused ? 0 : requestAnimationFrame(run);
  };
  const start = () => {
    if (!frameId) frameId = requestAnimationFrame(run);
  };

  const size = () => {
    width = host.clientWidth;
    if (!width) return;
    view = Math.min(width * VIEW_RATIO, VIEW_MAX);
    frame.style.width = `${width}px`;
    if (rail) rail.style.width = `${width}px`;
    // The titlebar's measures are fractions of the element's width; zoom brings them to CHROME.
    titlebar.style.zoom = String((CHROME * WIDTH) / (element.clientWidth || width));
    frame.style.height = `${TITLEBAR * CHROME + view}px`;
    screen.style.height = `${view}px`;
    place();
  };
  // The screen keeps its place under the titlebar and clips; the camera moves the video inside it.
  screen.style.aspectRatio = "auto";
  screen.style.overflow = "hidden";
  // Also as a clip-path: Chrome was seen to let the composited video past the overflow clip alone.
  screen.style.clipPath = "inset(0)";
  video.style.width = `${WIDTH}px`;
  video.style.height = `${HEIGHT}px`;
  video.style.maxWidth = "none";
  video.style.transformOrigin = "0 0";
  const resize = new ResizeObserver(size);
  resize.observe(host);
  const events = ["play", "pause", "seeked", "timeupdate", "loadeddata"] as const;
  for (const name of events) video.addEventListener(name, name === "play" ? start : place);
  reduced.addEventListener("change", place);
  size();
  if (!video.paused) start();

  return () => {
    cancelAnimationFrame(frameId);
    resize.disconnect();
    for (const name of events) video.removeEventListener(name, name === "play" ? start : place);
    reduced.removeEventListener("change", place);
    titlebar.style.removeProperty("zoom");
    for (const property of ["width", "height"]) frame.style.removeProperty(property);
    rail?.style.removeProperty("width");
    for (const property of ["height", "aspect-ratio", "overflow", "clip-path"]) screen.style.removeProperty(property);
    for (const property of ["width", "height", "max-width", "transform", "transform-origin"]) video.style.removeProperty(property);
  };
}
