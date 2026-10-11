import type { Point } from "../math";
import { type BirdPose, birdPose } from "./bird/cell-bird";
import type { FlightRoom } from "./bird/flight-room";
import { type Extent, type Frames, PERCHED_FEET } from "./bird/frames";
import { GhostFlight } from "./bird/ghost-flight";
import { INTRO_END, INTRO_PACE, IntroFlight } from "./bird/intro-flight";

/** How long the hatch's flash and ring play before the grid settles, s. */
const HATCH = 1.6;
/** The first ghost comes this long after the intro, give or take; later ones are further apart. */
const FIRST_GHOST = [7, 5] as const;
const NEXT_GHOST = [14, 8] as const;

export type TimelineHooks = {
  /** Writes the perch on the headline, in viewport px; false before the headline is laid out. */
  perch(out: Point): boolean;
  /** True once the porcelain bird can take over. */
  birdReady(): boolean;
  /** Hand the cell bird over to the porcelain one: place it on the perch. */
  resolve(): void;
  /** Turn the porcelain bird's head toward a point. */
  look(point: Point): void;
  /** Once, when the intro is over or skipped. */
  settled(): void;
  /** The porcelain bird arrives: a ring spreads from its feet. */
  arrive(point: Point): void;
};

type Stage = "intro" | "landed" | "hatching" | "settled";

/**
 * The scene's story over time: the intro flight, the wait on the headline until the porcelain bird
 * has loaded, the hatch, then the settled loop with a ghost now and then. Each frame it leaves the
 * birds to draw in `main` and `ghost`.
 */
export class Timeline {
  main: BirdPose | null = null;
  ghost: BirdPose | null = null;
  private stage: Stage = "intro";
  private introTime = 0;
  private hatchedAt = 0;
  private nextGhost = 0;
  private readonly intro: IntroFlight;
  private readonly crossing: GhostFlight;
  private readonly perched: BirdPose;
  private readonly perch: Point = { x: 0, y: 0 };
  private readonly ring: Point = { x: 0, y: 0 };

  constructor(
    frames: Frames,
    flying: Extent,
    perchedExtent: Extent,
    private readonly hooks: TimelineHooks,
    private readonly random: () => number,
  ) {
    this.intro = new IntroFlight(frames, flying, perchedExtent);
    this.crossing = new GhostFlight(frames, flying);
    this.perched = birdPose(frames, true);
  }

  get settled(): boolean {
    return this.stage === "settled";
  }

  /** Straight to the settled loop: reduced motion, or a reload part-way down the page. */
  skip() {
    if (this.stage === "settled") return;
    this.stage = "settled";
    this.main = null;
    this.hooks.settled();
  }

  /** Stops a ghost mid-crossing, for reduced motion. */
  calm() {
    this.ghost = null;
    this.crossing.stop();
  }

  step(dt: number, now: number, room: FlightRoom, quiet: boolean) {
    const hasPerch = this.hooks.perch(this.perch);
    this.main = null;
    if (this.stage === "intro") {
      this.introTime += dt * INTRO_PACE;
      if (hasPerch) this.main = this.intro.at(this.introTime, dt, room, this.perch);
      if (this.introTime >= INTRO_END) this.stage = "landed";
    } else if (this.stage === "landed") {
      if (this.hooks.birdReady()) this.hatch(now, room, hasPerch);
      else if (hasPerch) this.main = this.standing(room, 0.9 + 0.1 * Math.sin(now * 3), 1);
    }
    if (this.stage === "hatching") {
      const age = now - this.hatchedAt;
      // A flash a little wider than the porcelain bird, so it shows around it as it fades in.
      const v = age < 0.12 ? 1 : Math.max(0, 1 - (age - 0.12) / 0.7) ** 1.4;
      if (hasPerch && v > 0) this.main = this.standing(room, v, 1 + 0.18 * Math.min(1, age / 0.25));
      if (age > HATCH) {
        this.stage = "settled";
        this.nextGhost = now + FIRST_GHOST[0] + this.random() * FIRST_GHOST[1];
        this.hooks.settled();
      }
    }
    if (this.stage === "settled" && !quiet && !this.crossing.active && now >= this.nextGhost) {
      if (!this.crossing.launch(room, this.random)) this.nextGhost = now + NEXT_GHOST[0];
    }
    const wasCrossing = this.crossing.active;
    this.ghost = this.crossing.step(dt, room, this.hooks.look);
    if (wasCrossing && !this.crossing.active) this.nextGhost = now + NEXT_GHOST[0] + this.random() * NEXT_GHOST[1];
  }

  private hatch(now: number, room: FlightRoom, hasPerch: boolean) {
    this.hooks.resolve();
    this.stage = "hatching";
    this.hatchedAt = now;
    if (!hasPerch) return;
    this.ring.x = this.perch.x;
    this.ring.y = this.perch.y - room.perchedScale * 0.3;
    this.hooks.arrive(this.ring);
  }

  /** The cell bird on the perch at the porcelain bird's size, times `grow`. */
  private standing(room: FlightRoom, intensity: number, grow: number): BirdPose {
    const pose = this.perched;
    const s = room.perchedScale * grow;
    pose.x = this.perch.x + PERCHED_FEET.x * s;
    pose.y = this.perch.y - PERCHED_FEET.y * s;
    pose.scale = s;
    pose.flip = -1;
    pose.perch = 1;
    pose.intensity = intensity;
    pose.dir = -1;
    return pose;
  }
}
