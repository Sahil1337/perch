import { clamp } from "../../math";
import { REDUCED_MOTION } from "../../viewport/media";
import type { SceneAnchors } from "../types";

// The recording's coordinate space, as walk.js draws it: 1280 wide, a 40px titlebar over 760 of app.
const WIDTH = 1280;
const TITLEBAR = 40;
// How much of the app shows under the titlebar: the clause stepper and the rows under it. Below
// that the recording is the table's tail and an empty pane.
const WALK_CLOSE_UP_ROWS = 600;
// The smallest scale the recording is drawn at on a phone, where the whole window would be ~0.28
// and its 12px type 3px. At this its type is about 8px.
const WALK_CLOSE_UP_SCALE = 0.66;
// Until GROUP BY the story is the source table, whose id and name columns sit at the left; from it on
// the rows have collapsed into groups and results drawn round x 440.
const GROUPS_FROM = 15.9;
const TABLE_LEFT = 20;
const GROUPS_CENTRE = 440;

/**
 * Below lg: draws <perch-walk>'s recording at a readable scale and shows a crop of it, the window and
 * its titlebar at the element's width and the clause rail under them as before. The crop pans once a
 * loop, keyed to the video's own time, from the source table to the groups. Returns the undo.
 */
export function closeUpWalk(host: HTMLElement, anchors: SceneAnchors): () => void {
  const { window: frame, titlebar } = anchors;
  const screen = titlebar.nextElementSibling;
  const video = screen?.querySelector("video");
  if (!(screen instanceof HTMLElement) || !video) return () => {};
  const reduced = matchMedia(REDUCED_MOTION);

  let scale = WALK_CLOSE_UP_SCALE;
  let width = 0;
  let placed = false;
  const place = () => {
    const view = width / scale;
    const left = video.currentTime < GROUPS_FROM ? TABLE_LEFT : GROUPS_CENTRE - view / 2;
    const pan = clamp(left, 0, WIDTH - view);
    // The first placement lands at once; only the pan between stories is seen to move.
    const still = reduced.matches || !placed;
    screen.style.transition = still ? "none" : "transform 1.4s cubic-bezier(0.65, 0, 0.35, 1)";
    screen.style.transform = `translateX(${(-pan * scale).toFixed(1)}px)`;
    placed = true;
  };
  const size = () => {
    width = host.clientWidth;
    if (!width) return;
    scale = Math.max(WALK_CLOSE_UP_SCALE, width / WIDTH);
    // The titlebar's measures are fractions of the element's width; zoom brings them to the crop's scale.
    titlebar.style.zoom = String((scale * WIDTH) / width);
    frame.style.height = `${(TITLEBAR + WALK_CLOSE_UP_ROWS) * scale}px`;
    screen.style.width = `${WIDTH * scale}px`;
    place();
  };
  const resize = new ResizeObserver(size);
  resize.observe(host);
  video.addEventListener("timeupdate", place);
  video.addEventListener("seeked", place);
  size();

  return () => {
    resize.disconnect();
    video.removeEventListener("timeupdate", place);
    video.removeEventListener("seeked", place);
    titlebar.style.removeProperty("zoom");
    frame.style.removeProperty("height");
    for (const property of ["width", "transform", "transition"]) screen.style.removeProperty(property);
  };
}
