import { clamp, type Point } from "../../../../shared/math";

/** A point the flight passes through at time t. */
export type Waypoint = { t: number; x: number; y: number };

export const waypoints = (count: number): Waypoint[] => Array.from({ length: count }, () => ({ t: 0, x: 0, y: 0 }));

const before: Waypoint = { t: 0, x: 0, y: 0 };
const after: Waypoint = { t: 0, x: 0, y: 0 };

/**
 * Catmull-Rom through timed waypoints: writes the position and the velocity (px/s) at time t. The
 * tangents are scaled to each segment's duration, so speed carries smoothly across uneven timings.
 */
export function spline(points: readonly Waypoint[], t: number, pos: Point, vel: Point) {
  let i = 0;
  while (i < points.length - 2 && t > (points[i + 1]?.t ?? Infinity)) i++;
  const p1 = points[i];
  const p2 = points[i + 1];
  if (!p1 || !p2) return;
  let p0 = points[i - 1];
  if (!p0) {
    before.t = p1.t - (p2.t - p1.t);
    before.x = 2 * p1.x - p2.x;
    before.y = 2 * p1.y - p2.y;
    p0 = before;
  }
  let p3 = points[i + 2];
  if (!p3) {
    after.t = p2.t + (p2.t - p1.t);
    after.x = p2.x;
    after.y = p2.y;
    p3 = after;
  }
  const span = p2.t - p1.t;
  const u = clamp((t - p1.t) / span, 0, 1);
  const m1x = ((p2.x - p0.x) / (p2.t - p0.t)) * span;
  const m1y = ((p2.y - p0.y) / (p2.t - p0.t)) * span;
  const m2x = ((p3.x - p1.x) / (p3.t - p1.t)) * span;
  const m2y = ((p3.y - p1.y) / (p3.t - p1.t)) * span;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  pos.x = h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x;
  pos.y = h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y;
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  vel.x = (d00 * p1.x + d10 * m1x + d01 * p2.x + d11 * m2x) / span;
  vel.y = (d00 * p1.y + d10 * m1y + d01 * p2.y + d11 * m2y) / span;
}
