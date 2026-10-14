import type { Bird } from "./bird";

const holds = new WeakMap<Bird, number>();
const waiting = new WeakMap<Bird, Set<() => void>>();

/**
 * Keeps the bird where it stands until the returned release() is called: whatever flies it on a
 * timer (roam, the landing's idle hops) waits, and picks up again when the last hold lets go. A
 * scroll still moves it, so a reader is never left without it. release() may be called more than
 * once; only the first counts.
 */
export function holdBird(bird: Bird): () => void {
  holds.set(bird, (holds.get(bird) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holds.get(bird) ?? 1) - 1;
    if (left > 0) return void holds.set(bird, left);
    holds.delete(bird);
    for (const listener of waiting.get(bird) ?? []) listener();
  };
}

export function isHeld(bird: Bird): boolean {
  return holds.has(bird);
}

/** Calls back each time the last hold on the bird is released. Returns stop(). */
export function onRelease(bird: Bird, listener: () => void): () => void {
  let set = waiting.get(bird);
  if (!set) waiting.set(bird, (set = new Set()));
  set.add(listener);
  return () => void set.delete(listener);
}
