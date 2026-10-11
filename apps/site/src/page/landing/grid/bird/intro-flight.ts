import { clamp, easeInOutCubic, type Point, smoothstep } from "../../math";
import { type BirdPose, birdPose } from "./cell-bird";
import { band, fitBand, type FlightRoom } from "./flight-room";
import { type Extent, FLAP_FRAMES, type Frames, PERCHED_FEET } from "./frames";
import { spline, waypoints } from "./spline";

/** The choreography's times, in its own seconds; it plays INTRO_PACE times faster. */
const LOW_END = 2.7;
const APPROACH_START = 3.2;
/** When the cell bird stands on the headline, and when it has condensed to the porcelain bird's size. */
export const LAND_AT = 5.45;
export const INTRO_END = 6.0;
export const INTRO_PACE = 1.12;
/** Px kept between a bird entering or leaving and the view's edge, so it starts and ends unseen. */
const OFF = 4;

/**
 * The cell bird's entrance. It crosses low, in the room under the copy, flapping and gliding in
 * bursts, and leaves by the right edge. It comes back round from the right, smaller, in the room
 * over the headline, and glides down onto the perch, flaring with its wings up and legs reaching.
 * Standing there, it condenses, feet fixed, onto the porcelain bird's footprint.
 */
export class IntroFlight {
  readonly pose: BirdPose;
  private readonly low = waypoints(4);
  private readonly approach = waypoints(4);
  private readonly lowBand = band();
  private readonly pos: Point = { x: 0, y: 0 };
  private readonly vel: Point = { x: 0, y: 0 };
  private readonly pull: Point = { x: 0, y: 0 };
  private landingScale = 1;
  private flipMix = 1;
  private glideMix = 0;
  private phase = 0;
  /** What the passes were last laid out for: the room's size, the copy's extent and the perch. */
  private readonly plannedFor = new Float64Array(6).fill(NaN);

  constructor(
    private readonly frames: Frames,
    private readonly flying: Extent,
    private readonly perched: Extent,
  ) {
    this.pose = birdPose(frames, true);
  }

  /** The pose at choreography time t, or null while the bird is out of view between its passes. */
  at(t: number, dt: number, room: FlightRoom, perch: Point): BirdPose | null {
    this.plan(room, perch);
    const pose = this.pose;
    if (t >= LAND_AT) return this.condense(t, room, perch);
    if (t > LOW_END && t < APPROACH_START) {
      // Round the corner, unseen: it comes back facing left.
      this.flipMix = -1;
      return null;
    }
    const approaching = t >= APPROACH_START;
    spline(approaching ? this.approach : this.low, t, this.pos, this.vel);
    const speed = Math.hypot(this.vel.x, this.vel.y);
    const final = smoothstep(4.4, 4.8, t);
    const flare = smoothstep(4.75, 5.1, t) * (1 - smoothstep(5.2, LAND_AT, t));
    const perching = smoothstep(5.2, LAND_AT, t);

    // Facing follows the horizontal speed; the swap is quick, thinning for a moment like a bank.
    const facing = Math.abs(this.vel.x) > 0.2 * speed ? Math.sign(this.vel.x) : this.flipMix > 0 ? 1 : -1;
    this.flipMix += (facing - this.flipMix) * Math.min(1, dt * 7);
    let flip = final > 0.5 ? -1 : this.flipMix;
    if (Math.abs(flip) < 0.35) flip = flip < 0 ? -0.35 : 0.35;

    // Wings beat climbing and in bursts on the level; descending, and on the way in, it glides.
    const climbing = this.vel.y < -0.15 * speed;
    const burst = Math.sin(t * 2.4) > -0.35;
    const glideTarget = final > 0 || (approaching && !climbing) ? 1 : climbing || burst ? 0 : 1;
    this.glideMix += (glideTarget - this.glideMix) * Math.min(1, dt * 5);
    const beat = climbing ? 3.0 : 2.5;
    if (this.glideMix < 0.9 || this.phase % 1 > 0.05) this.phase += dt * beat * (1 - final * 0.6);
    const f = this.phase * FLAP_FRAMES;
    const i0 = Math.floor(f) % FLAP_FRAMES;

    pose.x = this.pos.x;
    pose.y = this.pos.y;
    pose.scale = approaching ? this.landingScale : this.lowBand.scale;
    pose.flip = flip;
    pose.angle =
      clamp(Math.atan2(this.vel.y, Math.abs(this.vel.x) + 1e-3) * 0.55, -0.6, 0.6) * Math.sign(flip) * (1 - flare) * (1 - perching);
    pose.a = this.frames.flap[i0] ?? this.frames.glide;
    pose.b = this.frames.flap[(i0 + 1) % FLAP_FRAMES] ?? this.frames.glide;
    pose.ab = f - Math.floor(f);
    pose.glide = this.glideMix * (1 - flare) * (1 - perching);
    pose.flare = flare * (1 - perching);
    pose.perch = perching;
    pose.intensity = 1;
    pose.wake = approaching ? 0.5 * (1 - final) : 1;
    pose.dir = Math.sign(this.vel.x) || -1;
    pose.pull = null;
    return pose;
  }

  /** On the headline: it stands at landing size, then shrinks onto the porcelain bird's footprint, brightening. */
  private condense(t: number, room: FlightRoom, perch: Point): BirdPose {
    const pose = this.pose;
    const k = easeInOutCubic(smoothstep(LAND_AT + 0.12, INTRO_END, t));
    const s = this.landingScale + (room.perchedScale - this.landingScale) * k;
    pose.x = perch.x + PERCHED_FEET.x * s;
    pose.y = perch.y - PERCHED_FEET.y * s;
    // Drawn in toward its body, not its feet: the feet are on the headline.
    this.pull.x = pose.x;
    this.pull.y = pose.y;
    pose.scale = s;
    pose.flip = -1;
    pose.angle = 0;
    pose.a = this.frames.perch;
    pose.b = this.frames.perch;
    pose.ab = 0;
    pose.glide = 0;
    pose.flare = 0;
    pose.perch = 1;
    pose.intensity = 0.95 + 0.45 * k;
    pose.wake = k > 0 ? 0.9 : 0;
    pose.dir = -1;
    pose.pull = this.pull;
    return pose;
  }

  /** Lays the two passes out for this room and perch; again only when either has moved. */
  private plan(room: FlightRoom, perch: Point) {
    const last = this.plannedFor;
    if (
      last[0] === room.width &&
      last[1] === room.height &&
      last[2] === Math.round(room.copyTop) &&
      last[3] === Math.round(room.copyBottom) &&
      last[4] === Math.round(perch.x) &&
      last[5] === Math.round(perch.y)
    )
      return;
    last[0] = room.width;
    last[1] = room.height;
    last[2] = Math.round(room.copyTop);
    last[3] = Math.round(room.copyBottom);
    last[4] = Math.round(perch.x);
    last[5] = Math.round(perch.y);
    const { width: W, body } = room;
    const feetY = PERCHED_FEET.y;
    const fly = this.flying;

    // As big as the room over the headline allows, and never smaller than the porcelain bird.
    const roomAbove = (perch.y - body - 6) / (feetY - this.perched.top);
    const s2 = clamp(roomAbove, room.perchedScale * 1.4, room.flightScale * 0.62);
    this.landingScale = s2;

    const low = this.lowBand;
    if (!fitBand(room, fly, room.flightScale, "below", low)) {
      low.scale = s2;
      low.y = room.height * 0.82;
      low.slack = 0;
    }
    const s1 = low.scale;
    const points = this.low;
    set(points[0], 0, -fly.right * s1 - OFF, low.y + low.slack * 0.2);
    set(points[1], 1.0, 0.3 * W, low.y + low.slack * 0.5);
    set(points[2], 2.0, 0.68 * W, low.y - low.slack * 0.3);
    set(points[3], LOW_END, W - fly.left * s1 + OFF, low.y - low.slack * 0.8);

    // Facing left, the silhouette is mirrored: its right edge is the field's left one.
    const endX = perch.x + PERCHED_FEET.x * s2;
    const endY = perch.y - feetY * s2;
    // On the way in it keeps its body over the headline's line box, and its head under the header
    // where it can; where the room cannot hold it, the header covers its head rather than it the words.
    const lowest = room.copyTop - fly.bottom * s2;
    const highest = Math.min(lowest, body - fly.top * s2);
    const startX = W + fly.right * s2 + OFF;
    const approach = this.approach;
    set(approach[0], APPROACH_START, startX, clamp(endY - 0.3 * s2, highest, lowest));
    set(approach[1], 4.3, endX + (startX - endX) * 0.4, clamp(endY - 0.16 * s2, highest, lowest));
    set(approach[2], 4.95, endX + 0.1 * s2, endY - 0.04 * s2);
    set(approach[3], LAND_AT, endX, endY);
  }
}

function set(point: { t: number; x: number; y: number } | undefined, t: number, x: number, y: number) {
  if (!point) return;
  point.t = t;
  point.x = x;
  point.y = y;
}
