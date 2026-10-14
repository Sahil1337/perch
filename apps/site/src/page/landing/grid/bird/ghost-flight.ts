import { type Point, smoothstep } from "../../../../shared/math";
import { type BirdPose, birdPose } from "./cell-bird";
import { band, fitBand, type FlightRoom } from "./flight-room";
import { type Extent, FLAP_FRAMES, type Frames } from "./frames";

/** The ghost is this much of the intro bird's full flight size, and this bright. */
const SIZE = 0.62;
const BRIGHTNESS = 0.36;
const WAKE = 0.35;
/** The porcelain bird turns to it this many times on the way across. */
const LOOKS = 2;

/**
 * Now and then, once the intro is over, a faint bird of cells crosses the grid in the room above or
 * below the copy, with a gentle wake, and the porcelain bird turns its head to follow it.
 */
export class GhostFlight {
  readonly pose: BirdPose;
  private readonly lane = band();
  private readonly gaze: Point = { x: 0, y: 0 };
  private t = 0;
  private duration = 0;
  private dir = 1;
  private looked = 0;
  private crossing = false;

  constructor(
    private readonly frames: Frames,
    private readonly extent: Extent,
  ) {
    this.pose = birdPose(frames, false);
  }

  get active(): boolean {
    return this.crossing;
  }

  /** Starts a crossing; false when there is no room beside the copy. */
  launch(room: FlightRoom, random: () => number): boolean {
    if (!fitBand(room, this.extent, room.flightScale * SIZE, random() < 0.5 ? "above" : "below", this.lane)) return false;
    this.dir = random() < 0.5 ? 1 : -1;
    this.t = 0;
    this.duration = (room.width + this.lane.scale * 2) / Math.max(260, room.width * 0.24);
    this.looked = 0;
    this.crossing = true;
    return true;
  }

  stop() {
    this.crossing = false;
  }

  /** Advances the crossing; the pose, or null once it is over. */
  step(dt: number, room: FlightRoom, look: (point: Point) => void): BirdPose | null {
    if (!this.crossing) return null;
    this.t += dt;
    const k = this.t / this.duration;
    if (k >= 1) {
      this.crossing = false;
      return null;
    }
    const pose = this.pose;
    const s = this.lane.scale;
    const x0 = this.dir > 0 ? -s : room.width + s;
    const x1 = this.dir > 0 ? room.width + s : -s;
    pose.x = x0 + (x1 - x0) * k;
    pose.y = this.lane.y + Math.sin(this.t * 1.3) * this.lane.slack * 0.5;
    if (this.looked < LOOKS && k > 0.25 + this.looked * 0.3) {
      this.looked++;
      this.gaze.x = pose.x;
      this.gaze.y = pose.y;
      look(this.gaze);
    }
    const f = ((this.t * 2.2) % 1) * FLAP_FRAMES;
    const i0 = Math.floor(f) % FLAP_FRAMES;
    pose.scale = s;
    pose.flip = this.dir;
    pose.angle = Math.cos(this.t * 1.3) * -0.08 * this.dir;
    pose.a = this.frames.flap[i0] ?? this.frames.glide;
    pose.b = this.frames.flap[(i0 + 1) % FLAP_FRAMES] ?? this.frames.glide;
    pose.ab = f - Math.floor(f);
    pose.glide = Math.sin(this.t * 1.7) > 0.2 ? 0.8 : 0;
    pose.intensity = BRIGHTNESS * smoothstep(0, 0.12, k) * (1 - smoothstep(0.88, 1, k));
    pose.wake = WAKE;
    pose.dir = this.dir;
    return pose;
  }
}
