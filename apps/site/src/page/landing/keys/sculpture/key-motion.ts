import type { CanvasTexture, Group, MeshBasicMaterial } from "three";
import { smoothstep } from "../../../../shared/math";
import type { KeySpec } from "../keymap";

/** One key of the sculpture and how it moves. */
export type Key = {
  spec: KeySpec;
  /** 0 for the front row, counting back. */
  row: number;
  /** Turns about the key's front edge as the hand-over folds it. */
  pivot: Group;
  /** Carries the cap, and goes down when the key is pressed. */
  body: Group;
  legend: CanvasTexture;
  /** The soft dark where the key meets the floor. */
  contact: MeshBasicMaterial;
  /** The middle of the top, where the bird's feet go, in key units above the floor. */
  top: number;
  /** The spring: how far down the key is, and how fast it moves. */
  y: number;
  v: number;
  /** How far down it can go. */
  travel: number;
  /** The bird stands on it. */
  occupied: boolean;
  /** Pushes due later, from a ripple. */
  kicks: { at: number; v: number }[];
};

const STIFFNESS = 900;
// Under-damped a little, so a key comes back up with the faintest overshoot.
const DAMPING = 2 * 0.5 * Math.sqrt(STIFFNESS);
// A bird's weight holds its key a little down.
const PERCHED = 0.035;
// The springs take steps no longer than this, however long the frame.
const STEP = 1 / 120;
// The hand-over folds the front row first; each row back starts this much later, and takes this long.
const FOLD = { stagger: 0.14, length: 0.55 };

/** Moves every key's spring on by `dt` seconds, to `clock`. True while any key is still moving. */
export function stepKeys(keys: readonly Key[], clock: number, dt: number): boolean {
  let moving = false;
  const steps = Math.max(1, Math.ceil(dt / STEP));
  const h = dt / steps;
  for (const key of keys) {
    for (let k = key.kicks.length - 1; k >= 0; k--) {
      const kick = key.kicks[k];
      if (kick && kick.at <= clock) {
        key.v = Math.min(key.v, kick.v);
        key.kicks.splice(k, 1);
      }
    }
    const rest = key.occupied ? -PERCHED : 0;
    for (let s = 0; s < steps; s++) {
      key.v += (-STIFFNESS * (key.y - rest) - DAMPING * key.v) * h;
      key.y += key.v * h;
      if (key.y < -key.travel) {
        key.y = -key.travel;
        if (key.v < 0) key.v = 0;
      }
    }
    if (Math.abs(key.v) > 1e-3 || Math.abs(key.y - rest) > 1e-4 || key.kicks.length) moving = true;
    else {
      key.y = rest;
      key.v = 0;
    }
  }
  return moving;
}

/** Poses every key: down as far as its spring says, then tipped and sunk by the hand-over's `fold`. */
export function poseKeys(keys: readonly Key[], fold: number) {
  for (const key of keys) {
    const start = key.row * FOLD.stagger;
    const folded = smoothstep(start, start + FOLD.length, fold);
    key.body.position.y = key.y - folded * (key.spec.h + 0.15);
    key.pivot.rotation.x = folded * 0.5;
    key.contact.opacity = 0.7 * (1 - folded);
  }
}
