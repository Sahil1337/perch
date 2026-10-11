import { clamp, type Point } from "../../math";

const frame = (x: number, y: number, r: number, opacity: number): Keyframe => ({
  transform: `translate(${x}px, ${y}px) rotate(${r}deg)`,
  opacity,
});

// A kept row's flight: out of the key in an arc, quick off it and soft into its place.
export function arc(x0: number, y0: number, end: Point & { r: number }, rand: () => number): Keyframe[] {
  const peak = Math.min(y0, end.y) - 110 - rand() * 90;
  const cx = (x0 + end.x) / 2 + (rand() - 0.5) * 120;
  const spin = (rand() - 0.5) * 360;
  const frames: Keyframe[] = [];
  for (let k = 0; k <= 16; k++) {
    const e = 1 - (1 - k / 16) ** 3;
    const x = (1 - e) ** 2 * x0 + 2 * (1 - e) * e * cx + e * e * end.x;
    const y = (1 - e) ** 2 * y0 + 2 * (1 - e) * e * peak + e * e * end.y;
    frames.push(frame(x, y, spin * (1 - e) + end.r * e, k === 0 ? 0 : 1));
  }
  return frames;
}

// A thrown row is paper: up hard, then it stops climbing, rocks, and drifts down slowly, gone
// before it reaches the floor the keys stand on.
export function flutter(x0: number, y0: number, side: 1 | -1, rand: () => number): { frames: Keyframe[]; seconds: number } {
  const angle = side * (0.12 + rand() * 0.95);
  const speed = 720 + rand() * 520;
  let vx = Math.sin(angle) * speed;
  let vy = -Math.cos(angle) * speed;
  let x = x0;
  let y = y0;
  let r = 0;
  const fall = 150 + rand() * 90;
  const phase = rand() * 6.28;
  const seconds = 1.7 + rand() * 0.6;
  const steps = 30;
  const dt = seconds / steps;
  const frames: Keyframe[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k * dt;
    const falling = vy > 0;
    const low = clamp((y - y0 - 30) / 140, 0, 1);
    frames.push(frame(x, y, r, k === 0 ? 0 : Math.min(1, (1 - k / steps) * 2.5, 1 - low)));
    vy = falling ? Math.min(vy + 2200 * dt, fall) : vy + 2200 * dt;
    vx *= falling ? 0.9 : 0.97;
    x += vx * dt + (falling ? Math.sin(t * 4.5 + phase) * 70 * dt : 0);
    y += vy * dt;
    r = falling ? Math.sin(t * 4 + phase) * 28 : r + side * 260 * dt;
  }
  return { frames, seconds };
}
