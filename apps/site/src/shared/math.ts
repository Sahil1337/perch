export type Point = { x: number; y: number };

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Where `v` sits between `a` and `b`, as 0 to 1. */
export const linearstep = (a: number, b: number, v: number): number => clamp((v - a) / (b - a), 0, 1);

export function smoothstep(a: number, b: number, v: number): number {
  const t = linearstep(a, b, v);
  return t * t * (3 - 2 * t);
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A small deterministic random (mulberry32), so a reload plays the same flight. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** How far a value eased at `rate` per second moves toward its target over dt seconds. */
export const easeStep = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
