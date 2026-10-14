import { PerspectiveCamera, Vector3 } from "three";
import { KEYS } from "../keymap";

/** A box in the canvas's CSS px. */
export type Box = { x: number; y: number; w: number; h: number };

// Seen from above the front and a little to the right, at every desktop width.
const ELEVATION = 0.68;
const YAW = 0.26;
const VIEW = new Vector3(Math.sin(YAW) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(YAW) * Math.cos(ELEVATION));
// The vertical field of view over the frame's height, in degrees: long enough that the near keys
// don't swell.
const LENS = 24;
// The sculpture's extent: the corners of every key's box, its centre, and how wide it stands.
const CORNERS = KEYS.flatMap((k) =>
  [-1, 1].flatMap((sx) =>
    [-1, 1].flatMap((sz) => [0, k.h].map((y) => new Vector3(k.x + (sx * k.w) / 2, y, k.z + (sz * k.d) / 2))),
  ),
);
const LEFT = Math.min(...KEYS.map((k) => k.x - k.w / 2));
const RIGHT = Math.max(...KEYS.map((k) => k.x + k.w / 2));
/** The sculpture's width, in key units. */
export const SPAN = RIGHT - LEFT;
const BACK = Math.min(...KEYS.map((k) => k.z - k.d / 2));
const FRONT = Math.max(...KEYS.map((k) => k.z + k.d / 2));
export const CENTRE = new Vector3((LEFT + RIGHT) / 2, 0.2, (BACK + FRONT) / 2);
const projected = new Vector3();

// The camera looks at the sculpture from above the front; its axis is moved off the canvas centre
// to the frame's centre, and its distance is searched until the whole sculpture fits the frame.
// Returns the sculpture's box on a `width` × `height` canvas.
export function fitView(camera: PerspectiveCamera, frame: Box, width: number, height: number): Box {
  let cx = frame.x + frame.w / 2;
  let cy = frame.y + frame.h / 2;
  const place = (dist: number): Box => {
    const fullW = 2 * Math.max(cx, width - cx);
    const fullH = 2 * Math.max(cy, height - cy);
    camera.aspect = fullW / fullH;
    camera.fov = (2 * Math.atan(Math.tan(((LENS / 2) * Math.PI) / 180) * (fullH / frame.h)) * 180) / Math.PI;
    camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, width, height);
    camera.position.copy(CENTRE).addScaledVector(VIEW, dist);
    camera.lookAt(CENTRE);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of CORNERS) {
      projected.copy(c).project(camera);
      const x = ((projected.x + 1) / 2) * width;
      const y = ((1 - projected.y) / 2) * height;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  let bounds = place(1);
  for (let pass = 0; pass < 3; pass++) {
    let lo = 1;
    let hi = 80;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const b = place(mid);
      if (b.w <= frame.w && b.h <= frame.h) hi = mid;
      else lo = mid;
    }
    const b = place(hi);
    // perspective draws the near side bigger, so the box drifts off centre; move the axis back
    cx += frame.x + frame.w / 2 - (b.x + b.w / 2);
    cy += frame.y + frame.h / 2 - (b.y + b.h / 2);
    bounds = place(hi);
  }
  return bounds;
}

/** The sculpture's width over its height on screen, the same at any size: the view never changes. */
export const ASPECT = (() => {
  const box = fitView(new PerspectiveCamera(), { x: 0, y: 0, w: 1, h: 1 }, 1, 1);
  return box.w / box.h;
})();

