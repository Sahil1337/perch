import { clamp, easeInOutCubic } from "../../math";
import { REDUCED_MOTION } from "../../viewport/media";
import type { SceneAnchors } from "../types";

// The phone recording (capture/README.md): the app 470 wide and 1100 tall, its walk stacked as
// stepper and table over the step's explanation and the query.
const WIDTH = 470;
const HEIGHT = 1100;
// How much of it the window shows at once; legacy.css reserves the window at this height.
const VIEW = 650;
// The two framings: the stepper over the table, and the explanation with the query under it.
const TABLE = 0;
const PANE = HEIGHT - VIEW;

const MOVE_S = 0.8;
// After a clause lights, how long the rows stay in view before the camera goes down to it.
const LIGHT_S = 0.6;
// The least time the explanation is held from when its text is up, and the rows after it.
const READ_S = 2.2;
const ROWS_S = 1.5;

type Stage = { t: number };
type Walk = { duration: number; stages: Stage[] };

/**
 * When each move starts and where it goes, from the recording's clause times: each clause lights
 * over the rows, then its explanation is read, then its rows change. A clause too short for the
 * rows keeps the explanation up, so the next one's text replaces it in place. The loop ends on the
 * rows, as it starts.
 */
function script({ duration, stages }: Walk): [number, number][] {
  const moves: [number, number][] = [[0, TABLE]];
  let on = TABLE;
  let arrived = 0;
  stages.forEach((stage, i) => {
    const next = stages[i + 1]?.t ?? duration;
    if (on === TABLE) {
      const go = Math.max(stage.t + LIGHT_S, arrived);
      moves.push([go, PANE]);
      on = PANE;
      arrived = go + MOVE_S;
    }
    const read = Math.max(stage.t, arrived) + READ_S;
    if (next - read >= MOVE_S + ROWS_S || (i === stages.length - 1 && duration - MOVE_S >= read)) {
      const go = i === stages.length - 1 ? duration - MOVE_S : read;
      moves.push([go, TABLE]);
      on = TABLE;
      arrived = go + MOVE_S;
    }
  });
  return moves;
}

/**
 * Below md, on <perch-walk variant="phone">: the window shows VIEW of the recording's height and
 * moves between the rows and the explanation on the video's own clock, so a seek or the loop lands
 * on the right framing at once. Reduced motion holds on the explanation. Returns the undo.
 */
export function panWalk(anchors: SceneAnchors): () => void {
  const screen = anchors.titlebar.nextElementSibling;
  const video = screen?.querySelector("video");
  if (!(screen instanceof HTMLElement) || !video) return () => {};
  const reduced = matchMedia(REDUCED_MOTION);
  // Sized in the element's container units, as walk.js sizes the window, so no resize is watched.
  const app = (px: number) => `calc(100cqw * ${px} / ${WIDTH})`;
  screen.style.aspectRatio = "auto";
  screen.style.height = app(VIEW);
  screen.style.overflow = "hidden";
  // Also as a clip-path: Chrome was seen to let the composited video past the overflow clip alone.
  screen.style.clipPath = "inset(0)";
  video.style.height = app(HEIGHT);

  let moves: [number, number][] = [[0, TABLE]];
  const at = (time: number): number => {
    if (reduced.matches) return PANE;
    let i = 0;
    for (const [index, [start]] of moves.entries()) if (start <= time) i = index;
    const [start, top] = moves[i] ?? [0, TABLE];
    const from = moves[i - 1]?.[1] ?? TABLE;
    return from + (top - from) * easeInOutCubic(clamp((time - start) / MOVE_S, 0, 1));
  };
  const place = () => {
    video.style.transform = `translateY(${app(-at(video.currentTime))})`;
  };

  let live = true;
  fetch(`${import.meta.env.BASE_URL}legacy/data/walk-phone.json`)
    .then((r) => r.json() as Promise<Walk>)
    .then((walk) => {
      if (!live) return;
      moves = script(walk);
      place();
    })
    .catch(() => {});

  let frame = 0;
  const run = () => {
    place();
    frame = video.paused ? 0 : requestAnimationFrame(run);
  };
  const start = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const events = ["play", "pause", "seeked", "timeupdate", "loadeddata"] as const;
  for (const name of events) video.addEventListener(name, name === "play" ? start : place);
  reduced.addEventListener("change", place);
  place();
  if (!video.paused) start();

  return () => {
    live = false;
    cancelAnimationFrame(frame);
    for (const name of events) video.removeEventListener(name, name === "play" ? start : place);
    reduced.removeEventListener("change", place);
    for (const property of ["aspect-ratio", "height", "overflow", "clip-path"]) screen.style.removeProperty(property);
    for (const property of ["height", "transform"]) video.style.removeProperty(property);
  };
}
