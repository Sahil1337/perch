/**
 * Perch's bird: a low-poly 3D songbird that perches on page elements and flies between them.
 *
 * three.js comes from npm through ./three.js, which names only the classes the bird uses, so the
 * bundler splits a chunk of just those and fetches it on the first createBird():
 *
 *   import { createBird } from "./bird.js";
 *   const bird = await createBird({ look: "porcelain", size: 64, followPointer: true });
 *   bird.appear(document.querySelector("h1"), { at: 0.9 });
 *
 * createBird(options) -> Promise<Bird>
 *   look           "porcelain" (faceted, lit) | "line" (the mark's line drawing in 3D). Default "porcelain".
 *   palette        porcelain: { body, wing, beak, eye }. Default: light porcelain, for dark pages.
 *                  line: { fill, stroke, strokeWidth? } — fill is the page background; strokeWidth
 *                  is in CSS px. Default: { fill: "#0a0a0a", stroke: "#f5f5f5" }.
 *   size           Bird length (tail to beak) in CSS px. Default 64.
 *   followPointer  Now and then turn the head toward the pointer. Default false.
 *   reducedMotion  "auto" (follows prefers-reduced-motion, live) | true | false. Default "auto".
 *   container      Element the overlay is appended to. Default document.body.
 *   zIndex         Overlay z-index. Default 1000.
 *   debug          Adds bird.debug (pause, step, pose, state, stats) for the lab page.
 *
 * Bird
 *   perchOn(el, { at = 0.8, facing = "auto", offsetY = 0, via = [], pace = 1 }) -> Promise
 *       Fly to el's top edge and land. `at` is 0..1 along that edge; `facing` is "left" | "right" |
 *       "auto" (towards the middle of the page); `offsetY` lowers the branch for rounded corners or
 *       borders. `via` is points to fly through on the way ({ el, x, y }: px from el's top-left,
 *       so the path scrolls with it; or { x, y } in viewport px); `pace` below 1 is lazier.
 *       Resolves on landing. Called again mid-flight it bends the path from the current position
 *       and speed; earlier promises resolve on that landing.
 *   appear(el, opts) -> Promise     Place the bird on a perch without flying, with a short fade-in.
 *   flyIn(el, opts) -> Promise      Enter from off-screen and land, for a page-load moment.
 *   guide([{ el, at, facing, offsetY, band }, ...]) -> stop()
 *       As the page scrolls, fly to the step whose element is nearest the viewport's centre band.
 *       `band` (0..1, default 0.3) is how much of the viewport, centred, counts as that step's
 *       band: wider claims the bird earlier, narrower later. Checked once a frame while the page
 *       scrolls and acted on at once; guide(null) or the returned stop() ends it.
 *   setCeiling(el)                  Flights stay below el's bottom edge (a sticky nav); null lifts it.
 *   lookAt({ x, y })                Turn the head toward a viewport point for a moment.
 *   followPointer(on)
 *   hop(), flutter()                Small feedback moments.
 *   setLook(look, palette), setSize(px), setReducedMotion("auto" | true | false)
 *   on("land", fn(el)) / on("takeoff", fn(fromEl, toEl)) -> off()
 *       With the perch elements (fromEl is null when there was no perch). Also fired by
 *       reduced-motion crossfades; not by appear().
 *   perch                           Getter: { el, at, facing } of the current perch, or of the
 *                                   destination while flying; null before the first perch.
 *   position, flying, reducedMotion, size
 *                                   Getters: the feet in viewport px (null while hidden), whether it
 *                                   is taking off or in the air, whether it is keeping still, its length.
 *   destroy()
 *   renderer                        "webgl", or "svg" when WebGL is unavailable: the 2D mark,
 *                                   moved between perches by crossfading, with the same API.
 *
 * The bird stays glued to its perch as the page scrolls or the element moves; a perch that scrolls
 * away takes the bird with it. In flight it beats its wings climbing, glides descending, and on
 * the level flies in bursts. Under reduced motion there is no flight: perch changes crossfade and
 * the idle bird only blinks and turns its head. roam.ts keeps it moving around a page.
 */

const TAU = Math.PI * 2;
const SVG_NS = "http://www.w3.org/2000/svg";

// PerchMark's own path data, for the fallback and as the reference the 3D model is built against.
const MARK_BODY =
  "M20.5 8.2L18.3 7.2C17.8 5.3 15.5 4.4 14 5.6C13.2 6.2 12.4 6.5 11.6 7.2C10 8.6 9.6 10.85 7.9 12.2L3.95 15.3L5.55 17.35L9.3 14C10.3 15.6 13.8 18 16.2 15.6C17.6 14.2 18.4 12 18.3 10.5C18.2 9.6 18.4 9 18.6 8.9Z";
const MARK_LEGS = "M11.4 17L11 20M14.6 17L14.2 20";

// The model is built in the mark's units (its 24-unit box), y up, facing +x, feet at the origin,
// so the 3D bird in profile can be laid over the 2D mark and checked against it.
const LENGTH = 16.55; // tail end to beak tip
const PIVOT = 7.6; // centre of mass above the feet: flight rotates about it, perching about the feet
const HIP = [0.5, 4.5]; // the body leans and crouches about this
const NECK = [1.7, 11.0];
const TAIL_ROOT = [-3.4, 7.15];
const TAIL_DOWN = 0.66; // the mark's tail runs back and down at about 38 degrees
const YAW_SIDE = 0.34; // perched three-quarter view: this far off pure profile, toward the viewer
const YAW_FLY = 0.45; // in flight, turned a little more toward the viewer than when perched
const TAKEOFF = 0.17;
const BAND = 0.3; // guide(): the centre share of the viewport a step must reach
// The WebGL canvas's side, in bird lengths: room for the wings at full stretch with the body up to
// SLACK lengths off its centre either way.
const BOX = 4.4;
const SLACK = 0.85;

const DEFAULTS = {
  porcelain: { body: "#ebe8e3", wing: "#dcd7cf", beak: "#b9b2a7", eye: "#151413" },
  line: { fill: "#0a0a0a", stroke: "#f5f5f5" },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const bump = (t) => (t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0);

// Critically damped: reaches the target as fast as it can without overshooting it, so nothing on
// the body wobbles past where it is going.
function follow(s, target, omega, dt) {
  const x = s.v - target;
  const k = Math.exp(-omega * dt);
  const tmp = (s.d + omega * x) * dt;
  s.v = target + (x + tmp) * k;
  s.d = (s.d - omega * tmp) * k;
}

function seeded(seed) {
  if (typeof seed !== "number") return Math.random;
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createBird(options = {}) {
  const container = options.container || document.body;
  const zIndex = options.zIndex ?? 1000;
  let look = options.look === "line" ? "line" : "porcelain";
  let palette = { ...DEFAULTS[look], ...options.palette };
  let size = options.size > 0 ? options.size : 64;
  let following = !!options.followPointer;
  let motionPref = options.reducedMotion ?? "auto";
  const rand = seeded(options.seed);
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motionPref === "auto" ? mq.matches : !!motionPref;

  const stage = (await createGLView(container, zIndex)) || createSVGView(container, zIndex);
  stage.setLook(look, palette, size);

  const anchor = { x: -1e4, y: -1e4 }; // where the feet are, in viewport px
  const vel = { x: 0, y: 0 };
  const tmp = { x: 0, y: 0 };
  let mode = "hidden";
  let modeT = 0;
  let clock = 0;
  let seat = null; // the perch the feet are on
  let dest = null; // the perch it is flying to
  let flight = null;
  let fade = null;
  let ceiling = null; // flights keep below this element (a sticky nav)
  let dir = 1; // which way the bird faces on screen
  let opacity = 0;
  let phase = 0;
  const landers = [];
  const listeners = { land: new Set(), takeoff: new Set() };

  const KEYS = [
    "yaw", "pitch", "roll", "planted", "crouch", "lean", "spread", "amp", "dihedral", "sweep",
    "twist", "tailPitch", "tailFan", "legAir", "headYaw", "headPitch", "headRoll", "lift", "view",
    "glide",
  ];
  const S = {};
  const T = {};
  const W = {};
  const OMEGA = {
    yaw: 9, pitch: 8, roll: 7, planted: 14, crouch: 18, lean: 12, spread: 12, amp: 10,
    dihedral: 10, sweep: 10, twist: 10, tailPitch: 14, tailFan: 12, legAir: 14, headYaw: 16,
    headPitch: 16, headRoll: 14, lift: 20, view: 6, glide: 5,
  };
  for (const k of KEYS) S[k] = { v: 0, d: 0 };
  S.planted.v = 1;
  S.yaw.v = -YAW_SIDE;

  const out = { dir: 1 };
  const acts = { blink: -9, blink2: -9, flick: -9, hop: -9, flutter: -9, ruffle: -9, hopScale: 1 };
  const due = { look: 0, blink: 1.5, flick: 5, hop: 25, ruffle: 40 };
  const look_ = { yaw: 0, pitch: 0, roll: 0, track: false };
  let gaze = null;
  const pointer = { x: 0, y: 0, t: -1e9 };
  let override = null;
  let paused = false;
  const costs = new Float32Array(240);
  let costN = 0;

  const yawFor = (sign, off = YAW_SIDE) => (sign > 0 ? -off : -Math.PI + off);
  // Perched, we look down on the bird a touch so its back and folded wings read (the line look
  // stays close to the mark's pure profile). In flight we look down across its back, so the two
  // wings beat out to either side of the body rather than across its front.
  const restView = () => (look === "line" ? 0.06 : 0.2);
  const FLY_VIEW = 0.95;
  const emit = (name, ...args) => {
    for (const fn of listeners[name]) fn(...args);
  };

  function makePerch(el, o = {}) {
    if (!el || typeof el.getBoundingClientRect !== "function") {
      throw new TypeError("bird: a perch needs an element");
    }
    return {
      el,
      at: clamp(o.at ?? 0.8, 0, 1),
      facing: o.facing === "left" || o.facing === "right" ? o.facing : "auto",
      offsetY: o.offsetY ?? 0,
      via: Array.isArray(o.via) ? o.via.filter((w) => w && Number.isFinite(w.x) && Number.isFinite(w.y)) : [],
      pace: o.pace > 0 ? o.pace : 1,
      last: null,
    };
  }

  // Read every frame: scrolling, layout and moving elements all just move the branch.
  function perchPoint(p, o) {
    if (p.el.isConnected) {
      const r = p.el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        // keep the feet clear of the corners so the bird stands on the edge rather than off its end
        const inset = Math.min(r.width / 2, size * 0.22);
        o.x = clamp(r.left + p.at * r.width, r.left + inset, r.right - inset);
        o.y = r.top + p.offsetY;
        p.last = p.last || { x: 0, y: 0 };
        p.last.x = o.x;
        p.last.y = o.y;
        return o;
      }
    }
    if (p.last) {
      o.x = p.last.x;
      o.y = p.last.y;
    }
    return o;
  }

  function faceSign(p) {
    if (p.facing === "left") return -1;
    if (p.facing === "right") return 1;
    const mid = innerWidth / 2;
    if (anchor.x < mid - 24) return 1;
    if (anchor.x > mid + 24) return -1;
    return dir;
  }

  const samePerch = (a, b) =>
    a && b && a.el === b.el && Math.abs(a.at - b.at) < 1e-3 && a.offsetY === b.offsetY;

  function setMode(m) {
    mode = m;
    modeT = 0;
  }

  function arrive(announce = true) {
    if (announce) emit("land", seat.el);
    for (const res of landers.splice(0)) res();
  }

  function snapPerched() {
    for (const k of KEYS) {
      S[k].v = 0;
      S[k].d = 0;
    }
    S.planted.v = 1;
    S.view.v = restView();
    dir = faceSign(seat);
    S.yaw.v = yawFor(dir);
    vel.x = vel.y = 0;
  }

  function appearAt(p) {
    seat = p;
    dest = null;
    flight = null;
    perchPoint(p, anchor);
    snapPerched();
    fade = { out: false, to: p, quiet: true };
    opacity = 0;
    setMode("fade");
  }

  function fadeTo(p) {
    if (mode === "fade" && fade.out) {
      fade.to = p;
      return;
    }
    if (mode === "hidden") return appearAt(p);
    fade = { out: true, to: p };
    setMode("fade");
    emit("takeoff", seat?.el ?? null, p.el);
  }

  function flightTime(d) {
    return 0.7 + 0.9 * smooth(0, 1100, d);
  }

  // px/s along a path through via points, by its length
  const viaSpeed = (length) => lerp(320, 680, smooth(200, 1800, length));

  // A flight is a chain of cubic Hermite legs: from where the bird left, through any `via` points,
  // to the perch. Inner tangents are Catmull-Rom in time, so speed and heading run on through each
  // point. Every point is read again each frame, so a path tied to the page scrolls with it.
  function viaPoint(w, o) {
    if (w.el && w.el.isConnected) {
      const r = w.el.getBoundingClientRect();
      o.x = r.left + w.x;
      o.y = r.top + w.y;
    } else {
      o.x = w.x;
      o.y = w.y;
    }
    return o;
  }

  function resolvePath(fl) {
    const last = fl.P.length - 1;
    for (let i = 1; i < last; i++) viaPoint(fl.via[i - 1], fl.P[i]);
    perchPoint(dest, fl.P[last]);
  }

  // f: 0 for a hop along the branch, 1 for a full flight. v0 is the velocity it leaves with.
  function plan(p, v0, f, air, T1) {
    const via = p.via;
    const P = [{ x: anchor.x, y: anchor.y }, ...via.map(() => ({ x: 0, y: 0 })), { x: 0, y: 0 }];
    const fl = { t: 0, k: 0, legs: [], P, via, f, v0, v1: { x: 0, y: 0 }, arc: 0, air, flap: true, beat: air + 0.4 + rand() * 0.3 };
    resolvePath(fl);
    const pace = p.pace;
    if (!via.length) {
      fl.legs.push(T1 / pace);
    } else {
      const chords = [];
      for (let i = 1; i < P.length; i++) chords.push(Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
      // cruising speed rises with the length of the whole path, as a direct flight's does
      const speed = viaSpeed(chords.reduce((a, b) => a + b, 0)) * pace;
      for (const d of chords) fl.legs.push(Math.max(0.25, (d * 1.12) / speed));
    }
    const end = P[P.length - 1];
    const before = P[P.length - 2];
    fl.v1.x = (Math.sign(end.x - before.x) || dir) * 50 * f;
    fl.v1.y = 70 * f;
    return fl;
  }

  function launch() {
    const P1 = perchPoint(dest, tmp);
    const d = Math.hypot(P1.x - anchor.x, P1.y - anchor.y);
    // Below about a body length it is a hop along the branch, not a flight.
    const f = dest.via.length ? 1 : smooth(size * 0.6, size * 2.5, d);
    const T_ = lerp(0.42, flightTime(d), f);
    // A take-off is a jump: the bird leaves the perch already moving, up and toward where it is
    // going first.
    const first = dest.via.length ? viaPoint(dest.via[0], { x: 0, y: 0 }) : P1;
    const dx = first.x - anchor.x;
    const dy = first.y - anchor.y;
    const d0 = Math.hypot(dx, dy);
    const T0 = dest.via.length ? Math.max(0.25, (d0 * 1.12) / (viaSpeed(d0 + d) * dest.pace)) : T_ / dest.pace;
    const v0 = { x: (dx / T0) * 0.5, y: -(150 + 0.16 * d0 + Math.max(0, -dy) * 0.25) * lerp(0.6, 1, f) };
    flight = plan(dest, v0, f, 0, T_);
    flight.arc = dest.via.length ? 0 : (0.07 * d + 0.12 * size) * (dy > 0 ? 0.7 : 1);
    const from = seat;
    seat = null;
    setMode("flight");
    emit("takeoff", from?.el ?? null, dest.el);
  }

  function retarget(p) {
    dest = p;
    const P1 = perchPoint(p, tmp);
    const d = Math.hypot(P1.x - anchor.x, P1.y - anchor.y);
    const f = p.via.length ? 1 : Math.max(flight.f, smooth(size * 0.6, size * 2.5, d));
    // The new path starts where the bird is with the velocity it has, so nothing jumps: the
    // Hermite start tangent is that velocity, and the arc term has zero slope at u = 0.
    const old = flight;
    flight = plan(p, { x: vel.x, y: vel.y }, f, old.air, Math.max(0.55, flightTime(d) * 0.9));
    flight.arc = p.via.length ? 0 : 0.04 * d;
    flight.flap = old.flap;
    flight.beat = old.beat;
  }

  const tA = { x: 0, y: 0 };
  const tB = { x: 0, y: 0 };
  function tangent(fl, i, o) {
    const a = fl.P[i - 1];
    const b = fl.P[i + 1];
    const T_ = fl.legs[i - 1] + fl.legs[i];
    o.x = (b.x - a.x) / T_;
    o.y = (b.y - a.y) / T_;
    return o;
  }

  // Positions the bird on the current leg at u (0..1 along it) and sets its velocity.
  function flightAt(fl, u) {
    const n = fl.legs.length;
    const k = fl.k;
    const A = fl.P[k];
    const B = fl.P[k + 1];
    const mA = k === 0 ? fl.v0 : tangent(fl, k, tA);
    const mB = k === n - 1 ? fl.v1 : tangent(fl, k + 1, tB);
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const g00 = 6 * u2 - 6 * u;
    const g10 = 3 * u2 - 4 * u + 1;
    const g01 = -6 * u2 + 6 * u;
    const g11 = 3 * u2 - 2 * u;
    const m = 1 - u;
    const arc = 16 * u2 * m * m;
    const darc = 32 * u * m * (1 - 2 * u);
    const Tt = fl.legs[k];
    anchor.x = h00 * A.x + h10 * mA.x * Tt + h01 * B.x + h11 * mB.x * Tt;
    anchor.y = h00 * A.y + h10 * mA.y * Tt + h01 * B.y + h11 * mB.y * Tt - fl.arc * arc;
    vel.x = (g00 * A.x + g10 * mA.x * Tt + g01 * B.x + g11 * mB.x * Tt) / Tt;
    vel.y = (g00 * A.y + g10 * mA.y * Tt + g01 * B.y + g11 * mB.y * Tt - fl.arc * darc) / Tt;
    // Never up behind a sticky nav: the path is pressed down below it, eased in after the take-off
    // and out before the landing so neither end moves.
    if (ceiling && ceiling.isConnected) {
      const ease = smooth(0, 0.2, fl.air) * (k === n - 1 ? 1 - smooth(0.75, 1, u) : 1);
      const floor = ceiling.getBoundingClientRect().bottom + size * 0.95;
      const D = anchor.y - floor;
      // a smooth max with the floor, faded out well clear of it
      anchor.y += ((Math.hypot(D, size * 0.5) - D) / 2) * (1 - smooth(size * 2, size * 4, D)) * ease;
    }
  }

  function touchdown() {
    seat = dest;
    dest = null;
    flight = null;
    perchPoint(seat, anchor);
    vel.x = vel.y = 0;
    setMode("settle");
    // Landing facing the other way: turn round with a little hop rather than spinning in place.
    if (Math.abs(yawFor(faceSign(seat)) - S.yaw.v) > 1.5 && !reduced) {
      acts.hop = clock + 0.2;
      acts.hopScale = 0.55;
    }
    arrive();
  }

  // Head aim toward a world direction (x right, y up, z toward the viewer), in the bird's frame.
  function aimDir(wx, wy, wz) {
    const c = Math.cos(S.yaw.v);
    const s = Math.sin(S.yaw.v);
    const lx = wx * c - wz * s;
    const lz = wx * s + wz * c;
    T.headYaw = clamp(Math.atan2(-lz, lx), -2.0, 2.0);
    T.headPitch = clamp(Math.atan2(wy, Math.hypot(lx, lz)) - S.pitch.v, -0.6, 0.75);
  }

  function aimAt(x, y) {
    const k = size / LENGTH;
    const hx = anchor.x + dir * 3 * k;
    const hy = anchor.y - 12.5 * k;
    const dx = x - hx;
    const dy = hy - y;
    // a little depth toward the viewer, so a bird watching the pointer is also watching you
    aimDir(dx, dy, Math.hypot(dx, dy) * 0.3 + size * 0.4);
  }

  function pickLook() {
    const r = rand();
    // head yaw that turns the face toward the viewer depends on which side of the bird we see
    const toward = Math.cos(S.yaw.v) > 0 ? -1 : 1;
    look_.track = false;
    look_.roll = 0;
    if (following && clock - pointer.t < 4 && r < 0.45) {
      look_.track = true;
      due.look = clock + 1.6 + rand() * 1.6;
      return;
    }
    const q = rand();
    if (q < 0.42) {
      look_.yaw = toward * (rand() * 0.5 - 0.15);
      look_.pitch = rand() * 0.28 - 0.12;
      look_.roll = rand() * 0.24 - 0.12;
    } else if (q < 0.62) {
      look_.yaw = toward * (1.0 + rand() * 0.35);
      look_.pitch = 0.04;
      look_.roll = -toward * 0.12;
    } else if (q < 0.8) {
      look_.yaw = toward * (0.25 + rand() * 0.2);
      look_.pitch = 0.05;
      look_.roll = (rand() < 0.5 ? -1 : 1) * (0.28 + rand() * 0.16);
    } else {
      look_.yaw = -toward * (0.5 + rand() * 0.5);
      look_.pitch = 0.18 + rand() * 0.12;
    }
    due.look = clock + 1.3 + rand() * 2.6;
  }

  function idle() {
    // Under reduced motion the bird only blinks and now and then turns its head.
    if (reduced) {
      if (clock >= due.look) pickLook();
      T.headYaw = look_.track ? 0 : look_.yaw;
      T.headPitch = look_.track ? 0 : look_.pitch;
      T.headRoll = look_.track ? 0 : look_.roll;
      return;
    }
    const k = size / LENGTH;
    const nearPointer =
      following &&
      clock - pointer.t < 1.5 &&
      Math.hypot(pointer.x - anchor.x, pointer.y - (anchor.y - 8 * k)) < size * 2.5;
    if (gaze && clock < gaze.until) aimAt(gaze.x, gaze.y);
    else if (nearPointer || (look_.track && clock < due.look)) aimAt(pointer.x, pointer.y);
    else {
      if (clock >= due.look) pickLook();
      T.headYaw = look_.yaw;
      T.headPitch = look_.pitch;
      T.headRoll = look_.roll;
    }
    if (clock >= due.flick) {
      acts.flick = clock;
      due.flick = clock + 4 + rand() * 7;
    }
    if (clock >= due.hop) {
      acts.hop = clock;
      acts.hopScale = 1;
      due.hop = clock + 22 + rand() * 25;
    }
    if (clock >= due.ruffle) {
      acts.ruffle = clock;
      due.ruffle = clock + 30 + rand() * 35;
    }
  }

  function step(dt) {
    clock += dt;
    modeT += dt;
    for (const k of KEYS) {
      T[k] = 0;
      W[k] = OMEGA[k];
    }
    T.planted = 1;
    T.yaw = S.yaw.v;
    T.view = restView();
    let freq = 5;

    if (mode !== "perched") {
      // idle moments wait until the bird has been sitting a while, so a long flight does not
      // end in a hop, a flick and a ruffle all at once
      due.flick = Math.max(due.flick, clock + 1.5);
      due.hop = Math.max(due.hop, clock + 8);
      due.ruffle = Math.max(due.ruffle, clock + 10);
    }

    if (mode === "perched") {
      perchPoint(seat, anchor);
      dir = faceSign(seat);
      T.yaw = yawFor(dir);
      idle();
    } else if (mode === "takeoff") {
      perchPoint(seat, anchor);
      const P1 = perchPoint(dest, tmp);
      if (Math.abs(P1.x - anchor.x) > 8) dir = Math.sign(P1.x - anchor.x);
      T.yaw = yawFor(dir);
      W.yaw = 14;
      T.crouch = 1;
      W.crouch = 26;
      T.lean = -0.3;
      T.spread = 0.35;
      T.tailPitch = 0.35;
      T.headPitch = 0.12;
      // no crouch when the page is carrying the perch up under the nav: straight off it
      const low = ceiling?.isConnected ? ceiling.getBoundingClientRect().bottom + size * 1.1 : -Infinity;
      if (modeT >= TAKEOFF || anchor.y < low) launch();
    } else if (mode === "flight") {
      const fl = flight;
      fl.t += dt;
      fl.air += dt;
      const n = fl.legs.length;
      while (fl.k < n - 1 && fl.t >= fl.legs[fl.k]) fl.t -= fl.legs[fl.k++];
      const uk = Math.min(1, fl.t / fl.legs[fl.k]);
      resolvePath(fl);
      flightAt(fl, uk);
      // progress through the last leg, the approach; the landing is timed from it
      const u = fl.k === n - 1 ? uk : 0;
      // ease into the flight orientation over the first fifth of a second, so the take-off
      // reads as a jump and not as the bird tipping toward the viewer
      const into = smooth(0, 0.2, fl.air);
      const f = fl.f;
      if (Math.abs(vel.x) > 40) dir = Math.sign(vel.x);
      // The last third is the landing flare: wings held high and forward with short braking
      // beats, body tipped back, tail fanned, legs reaching for the branch.
      const flare = smooth(0.64, 0.92, u) * f;
      // Wingbeats on the way up, a glide on the way down, and on the level the bounding rhythm of
      // a small bird: a burst of beats, then a moment on still wings held in a shallow V. The
      // bursts are drawn from the seeded random, so they never fall into a cycle.
      if (fl.air >= fl.beat) {
        fl.flap = !fl.flap;
        fl.beat = fl.air + (fl.flap ? 0.3 + rand() * 0.45 : 0.18 + rand() * 0.3);
      }
      const level = (1 - smooth(50, 150, Math.abs(vel.y))) * smooth(120, 260, Math.abs(vel.x));
      T.glide =
        Math.max(smooth(40, 170, vel.y), fl.flap ? 0 : 0.85 * level) * smooth(0.25, 0.45, fl.air) * (1 - flare) * f;
      const glide = clamp(S.glide.v, 0, 1);
      T.yaw = yawFor(dir, lerp(YAW_SIDE, YAW_FLY, into));
      W.yaw = 7;
      T.view = lerp(restView(), FLY_VIEW, f * (1 - 0.5 * flare) * into);
      W.view = 8;
      // Flight pivots about the centre of mass; through the flare the pivot moves back to the
      // feet so the bird comes down feet first and then rocks forward onto them.
      T.planted = Math.max(1 - f, smooth(0.7, 0.9, u));
      W.planted = 16;
      T.legAir = f * (1 - smooth(0.62, 0.84, u));
      W.legAir = fl.air < 0.1 ? 8 : 16;
      W.crouch = 30;
      T.spread = lerp(0.3, 1, f);
      W.spread = 16;
      T.amp = lerp(0.35, 1, f) * (1 - 0.95 * glide) * (1 - 0.62 * flare);
      W.amp = 14;
      freq = lerp(6.2, 4.7, smooth(0, 0.4, fl.air)) + flare * 2.2 + 0.8 * smooth(40, 200, -vel.y);
      // a little dihedral while flapping keeps the far wing above the back at the bottom of the
      // stroke, so the bird always reads as two wings rather than one
      T.dihedral = 0.12 * f * (1 - glide) + 0.22 * glide + 0.95 * flare;
      T.sweep = 0.3 * flare - 0.06 * glide;
      T.twist = 0.15 * flare;
      W.pitch = 12;
      const climb = Math.atan2(-vel.y, Math.abs(vel.x) + 1);
      T.pitch = clamp(climb * 0.5, -0.42, 0.42) * f * (1 - flare) * into + 0.55 * flare;
      T.roll = clamp(-S.yaw.d * 0.11, -0.6, 0.6);
      T.tailFan = 0.25 + 0.75 * flare + 0.3 * glide;
      // in flight the tail lifts into line with the body, as birds carry it; it drops again to
      // brake in the flare
      T.tailPitch = 0.5 * f * into * (1 - flare) - 0.15 * flare;
      // birds hold the head level while the body pitches and rolls; this one also keeps an eye
      // on the viewer, which keeps its face readable while the body is turned away
      T.headPitch = -S.pitch.v * 0.7 - 0.1;
      T.headRoll = -S.roll.v * 0.5;
      T.headYaw = (Math.cos(S.yaw.v) > 0 ? -1 : 1) * 0.2 * f;
      if (fl.k === n - 1 && uk >= 1) touchdown();
    } else if (mode === "settle") {
      perchPoint(seat, anchor);
      dir = faceSign(seat);
      T.yaw = yawFor(dir);
      W.planted = 22;
      W.legAir = 24;
      W.crouch = 30;
      T.crouch = 0.7 * bump(modeT / 0.3);
      T.lean = -0.16 * bump(modeT / 0.3);
      T.tailPitch = 0.35 * bump((modeT - 0.04) / 0.4);
      // a beat with the wings up for balance, then they fold
      const hold = modeT < 0.14;
      T.spread = hold ? 0.8 : 0;
      W.spread = 10;
      T.dihedral = hold ? 0.9 : 0;
      W.dihedral = 12;
      W.amp = 18;
      W.pitch = 9;
      if (modeT > 0.65) setMode("perched");
    } else if (mode === "fade") {
      if (fade.out) {
        opacity = Math.min(opacity, 1 - easeInOut(Math.min(1, modeT / 0.2)));
        if (seat) perchPoint(seat, anchor);
        if (modeT >= 0.2) {
          seat = fade.to;
          dest = null;
          flight = null;
          perchPoint(seat, anchor);
          snapPerched();
          fade.out = false;
          modeT = 0;
        }
      } else {
        perchPoint(seat, anchor);
        opacity = easeInOut(Math.min(1, modeT / 0.26));
        if (modeT >= 0.26) {
          setMode("perched");
          arrive(!fade.quiet);
        }
      }
      dir = faceSign(seat || fade.to);
      T.yaw = yawFor(dir);
    }

    if (mode === "flight" || mode === "takeoff" || mode === "settle") opacity = 1;

    const fl = clock - acts.flutter;
    if (fl >= 0 && fl < 0.8 && !reduced) {
      const on = fl < 0.62;
      T.spread = Math.max(T.spread, on ? 0.9 : 0);
      T.amp = Math.max(T.amp, on ? 0.75 : 0);
      T.tailFan = Math.max(T.tailFan, on ? 0.7 : 0);
      T.lift = on ? size * 0.07 : 0;
      T.headPitch += 0.15;
      freq = 8.5;
    }

    for (const k of KEYS) follow(S[k], T[k], W[k], dt);
    phase = (phase + freq * dt) % 1;

    // Downstroke quicker than the upstroke; through the upstroke the hand folds to slip through
    // the air, which is what makes it read as a bird and not a flapping plank.
    const w = phase + 0.15 * Math.sin(Math.PI * phase);
    const e = Math.cos(TAU * w);
    const up = Math.max(0, Math.sin(TAU * (w - 0.5)));
    const amp = S.amp.v;
    const spread = clamp(S.spread.v, 0, 1);

    out.x = anchor.x;
    out.y = anchor.y;
    out.dir = dir;
    out.opacity = opacity;
    out.planted = clamp(S.planted.v, 0, 1);
    out.yaw = S.yaw.v;
    out.view = S.view.v;
    out.pitch = S.pitch.v;
    out.roll = S.roll.v;
    out.crouch = S.crouch.v;
    out.lean = S.lean.v;
    out.spread = spread;
    out.elev = (S.dihedral.v + amp * (e > 0 ? 1.0 : 0.52) * e) * spread;
    // swept a little back throughout and further on the upstroke, so the near wing comes down
    // beside and behind the body, never across its breast or face
    out.sweep = (S.sweep.v - amp * (0.08 + 0.25 * up)) * spread;
    out.twist = S.twist.v * spread;
    out.outerBend = amp * 0.9 * up * spread;
    out.outerSweep = amp * 0.45 * up * spread;
    out.tailPitch = S.tailPitch.v;
    out.tailFan = clamp(S.tailFan.v, 0, 1);
    out.legAir = clamp(S.legAir.v, 0, 1);
    out.headYaw = S.headYaw.v;
    out.headPitch = S.headPitch.v;
    out.headRoll = S.headRoll.v;
    out.lift = S.lift.v + amp * spread * size * 0.025 * Math.sin(TAU * w);
    out.breath = reduced || mode === "hidden" ? 0 : Math.sin(TAU * 0.42 * clock);
    out.ruffle = 0;
    out.blink = 0;
    actions();
    if (override) Object.assign(out, override);
  }

  function actions() {
    if (mode === "perched" || mode === "settle") {
      if (clock >= due.blink) {
        acts.blink = clock;
        due.blink = clock + 2.5 + rand() * 3.5;
        if (rand() < 0.2) acts.blink2 = clock + 0.22;
      }
    }
    const b = Math.max(bump((clock - acts.blink) / 0.15), bump((clock - acts.blink2) / 0.15));
    out.blink = b ** 0.7;
    if (reduced) return;

    const ft = (clock - acts.flick) / 0.42;
    if (ft >= 0 && ft < 1) {
      const a = ft < 0.2 ? 1 - (1 - ft / 0.2) ** 2 : 1 - easeInOut((ft - 0.2) / 0.8);
      out.tailPitch += 0.45 * a;
      out.tailFan = Math.min(1, out.tailFan + 0.45 * a);
    }

    const ht = clock - acts.hop;
    if (ht >= 0 && ht < 0.46) {
      const h = acts.hopScale;
      out.crouch += 0.55 * h * (bump(ht / 0.11) + bump((ht - 0.37) / 0.09));
      const air = (ht - 0.1) / 0.28;
      if (air > 0 && air < 1) {
        const s = Math.sin(Math.PI * air);
        out.lift += 4 * 0.2 * size * h * air * (1 - air);
        out.legAir = Math.max(out.legAir, 0.35 * s);
        out.spread = Math.max(out.spread, 0.2 * s);
        out.tailPitch += 0.25 * s;
      }
    }

    const rt = (clock - acts.ruffle) / 0.5;
    if (rt >= 0 && rt < 1) {
      const env = Math.sin(Math.PI * rt);
      out.ruffle = env * Math.sin(TAU * 6 * rt) * 0.5 + env * 0.5;
      out.spread = Math.max(out.spread, 0.12 * env);
      out.headRoll += 0.22 * env * Math.sin(TAU * 5 * rt);
    }
  }

  const SIG = [
    "x", "y", "opacity", "planted", "yaw", "view", "pitch", "roll", "crouch", "lean", "spread",
    "elev", "sweep", "twist", "outerBend", "outerSweep", "tailPitch", "tailFan", "legAir",
    "headYaw", "headPitch", "headRoll", "lift", "breath", "ruffle", "blink",
  ];
  // px for these, radians or 0..1 for the rest: below it a change between two frames cannot be seen
  const PX = new Set(["x", "y", "lift"]);
  const BREATH = SIG.indexOf("breath");
  const drawn = new Float64Array(SIG.length);
  let wasVisible = true;
  let dirty = true;
  let skipped = 0;
  // A canvas that is not drawn to keeps showing its last frame, so a bird that has not moved (an
  // off-screen perch, or reduced motion between blinks) costs nothing; one that is only breathing
  // is drawn at a third of the frame rate, which a slow swell of a few percent does not show.
  function draw() {
    const m = size * 2;
    const visible =
      opacity > 0.001 &&
      out.x > -m && out.x < innerWidth + m && out.y > -m && out.y < innerHeight + m * 1.5;
    let same = !dirty && visible === wasVisible;
    let calm = true;
    for (let i = 0; i < SIG.length; i++) {
      const d = Math.abs(out[SIG[i]] - drawn[i]);
      if (d > 1e-4) same = false;
      if (i !== BREATH && d > (PX.has(SIG[i]) ? 0.2 : 2e-3)) calm = false;
    }
    if (same || (!visible && !wasVisible && !dirty)) return;
    if (calm && visible && wasVisible && !dirty && ++skipped < 3) return;
    skipped = 0;
    for (let i = 0; i < SIG.length; i++) drawn[i] = out[SIG[i]];
    dirty = false;
    wasVisible = visible;
    stage.render(out, size, visible);
  }

  function tick(dt) {
    const t0 = performance.now();
    step(dt);
    draw();
    costs[costN++ % costs.length] = performance.now() - t0;
  }

  let raf = 0;
  let last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!paused) tick(dt);
  }
  function start() {
    if (!raf && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  const onResize = () => {
    stage.resize();
    dirty = true;
  };
  const onPointer = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.t = clock;
  };
  const onMotion = () => {
    if (motionPref === "auto") applyReduced(mq.matches);
  };
  function applyReduced(on) {
    reduced = on;
    if (!on) return;
    if (mode === "flight" || mode === "takeoff") fadeTo(dest);
    acts.flutter = acts.hop = acts.flick = acts.ruffle = -9;
  }
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("resize", onResize);
  addEventListener("pointermove", onPointer, { passive: true });
  mq.addEventListener("change", onMotion);
  start();

  let guideStop = null;
  function guide(steps) {
    if (guideStop) guideStop();
    const list = (steps || []).filter((s) => s && s.el);
    if (!list.length) return () => {};
    let current = null;
    const pick = () => {
      const mid = innerHeight / 2;
      let best = null;
      let bestD = Infinity;
      for (const s of list) {
        const r = s.el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        // A step's band is the share of the viewport, centred, in which it counts as reached.
        // Distances are measured in its own band's units (under 1 inside it, over 1 outside), so
        // a wider band claims the bird earlier and a narrower one later.
        const band = Math.max(1, (innerHeight * clamp(s.band ?? BAND, 0, 1)) / 2);
        const gap =
          r.bottom < mid - band ? mid - band - r.bottom : r.top > mid + band ? r.top - mid - band : 0;
        const d = gap
          ? 1 + gap / band
          : Math.min(1, Math.abs((r.top + r.bottom) / 2 - mid) / (band + r.height / 2));
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };
    let frame = 0;
    const go = () => {
      frame = 0;
      const s = pick();
      if (s && s !== current) {
        current = s;
        perchOn(s.el, s);
      }
    };
    // Checked once a frame while the page scrolls, and acted on at once: the bird sets off with the
    // reader rather than after them. Mid-flight a new pick bends the path.
    const schedule = () => {
      frame ||= requestAnimationFrame(go);
    };
    addEventListener("scroll", schedule, { passive: true, capture: true });
    addEventListener("resize", schedule);
    go();
    const stopGuide = () => {
      removeEventListener("scroll", schedule, { capture: true });
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      if (guideStop === stopGuide) guideStop = null;
    };
    guideStop = stopGuide;
    return stopGuide;
  }

  function perchOn(el, o) {
    const p = makePerch(el, o);
    return new Promise((res) => {
      landers.push(res);
      if (mode === "hidden") return appearAt(p);
      if (reduced || !stage.canFly) return fadeTo(p);
      if (mode === "fade") return fade.out ? (fade.to = p) : fadeTo(p);
      if (mode === "flight") return retarget(p);
      if (mode === "takeoff") {
        dest = p;
        return;
      }
      if (samePerch(p, seat)) {
        seat = p;
        arrive(false);
        return;
      }
      dest = p;
      setMode("takeoff");
    });
  }

  function flyIn(el, o) {
    if (mode !== "hidden") return perchOn(el, o);
    const p = makePerch(el, o);
    if (reduced || !stage.canFly) {
      return new Promise((res) => {
        landers.push(res);
        appearAt(p);
      });
    }
    return new Promise((res) => {
      landers.push(res);
      const P1 = perchPoint(p, tmp);
      anchor.x = P1.x;
      // Arrive already facing the way it will sit, so it lands without turning round.
      const sign = faceSign(p);
      const sx = sign > 0 ? -size * 1.5 : innerWidth + size * 1.5;
      const top = ceiling?.isConnected ? ceiling.getBoundingClientRect().bottom + size : -size;
      const sy = clamp(P1.y - Math.min(innerHeight * 0.3, 260), top, Math.max(top, innerHeight * 0.6));
      const d = Math.hypot(P1.x - sx, P1.y - sy);
      const T_ = flightTime(d) + 0.15;
      anchor.x = sx;
      anchor.y = sy;
      vel.x = sign * Math.min(560, (d / T_) * 1.1);
      vel.y = 30;
      dest = p;
      seat = null;
      dir = sign;
      flight = plan(p, { x: vel.x, y: vel.y }, 1, 1, T_);
      flight.arc = 0.05 * d;
      for (const k of KEYS) {
        S[k].v = 0;
        S[k].d = 0;
      }
      S.yaw.v = yawFor(sign, YAW_FLY);
      S.view.v = FLY_VIEW;
      S.spread.v = S.amp.v = S.legAir.v = 1;
      opacity = 1;
      setMode("flight");
    });
  }

  const bird = {
    renderer: stage.kind,
    get perch() {
      const p = dest || (mode === "fade" ? fade.to : null) || seat;
      return p ? { el: p.el, at: p.at, facing: p.facing } : null;
    },
    get position() {
      return mode === "hidden" ? null : { x: anchor.x, y: anchor.y };
    },
    get flying() {
      return mode === "flight" || mode === "takeoff";
    },
    get reducedMotion() {
      return reduced;
    },
    get size() {
      return size;
    },
    setCeiling(el) {
      ceiling = el && typeof el.getBoundingClientRect === "function" ? el : null;
    },
    perchOn,
    flyIn,
    guide,
    appear(el, o) {
      const p = makePerch(el, o);
      return new Promise((res) => {
        landers.push(res);
        if (mode === "hidden") appearAt(p);
        else fadeTo(p);
      });
    },
    lookAt({ x, y }) {
      gaze = { x, y, until: clock + 1.8 };
    },
    followPointer(on) {
      following = !!on;
    },
    hop() {
      if (reduced || (mode !== "perched" && mode !== "settle")) return;
      acts.hop = clock;
      acts.hopScale = 1;
    },
    flutter() {
      if (reduced) {
        acts.blink = clock;
        return;
      }
      // in the air it is a quick burst of beats
      if (mode === "perched" || mode === "settle" || mode === "flight") acts.flutter = clock;
    },
    setLook(next, pal) {
      look = next === "line" ? "line" : "porcelain";
      palette = { ...DEFAULTS[look], ...pal };
      stage.setLook(look, palette, size);
      dirty = true;
    },
    setSize(px) {
      if (px > 0) {
        size = px;
        stage.setLook(look, palette, size);
        dirty = true;
      }
    },
    setReducedMotion(v) {
      motionPref = v;
      applyReduced(v === "auto" ? mq.matches : !!v);
    },
    on(name, fn) {
      listeners[name]?.add(fn);
      return () => listeners[name]?.delete(fn);
    },
    destroy() {
      stop();
      if (guideStop) guideStop();
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("resize", onResize);
      removeEventListener("pointermove", onPointer);
      mq.removeEventListener("change", onMotion);
      for (const res of landers.splice(0)) res();
      stage.dispose();
    },
  };

  if (options.debug) {
    bird.debug = {
      pause(on = true) {
        paused = on;
      },
      step(dt = 1 / 60, n = 1) {
        for (let i = 0; i < n; i++) tick(dt);
      },
      pose(o) {
        override = o || null;
      },
      get state() {
        return { mode, x: anchor.x, y: anchor.y, vx: vel.x, vy: vel.y, leg: flight ? flight.k : null, u: flight ? flight.t / flight.legs[flight.k] : null, phase, ...out };
      },
      stats() {
        const a = Array.from(costs.subarray(0, Math.min(costN, costs.length))).sort((x, y) => x - y);
        return { frames: costN, median: a[a.length >> 1] ?? 0, p95: a[Math.floor(a.length * 0.95)] ?? 0 };
      },
    };
  }

  return bird;
}

async function createGLView(container, zIndex) {
  // three r163+ needs WebGL 2; probe for it before downloading the library at all
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) return null;
  probe.getExtension("WEBGL_lose_context")?.loseContext();
  let THREE;
  try {
    THREE = await import("./three.js");
  } catch {
    return null;
  }
  // The canvas is only a few bird lengths square and travels with the bird on the compositor, so
  // each frame fills and composites a small layer rather than one the size of the viewport.
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    left: "0",
    top: "0",
    pointerEvents: "none",
    zIndex: String(zIndex),
    opacity: "0",
    visibility: "hidden",
    willChange: "transform",
    contain: "strict",
  });
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  container.appendChild(canvas);
  renderer.setClearColor(0x000000, 0);

  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, NEAR, FAR);
  camera.position.z = (NEAR + FAR) / 2;
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8f8a82, 2.2);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-0.55, 1, 0.85);
  const rim = new THREE.DirectionalLight(0xffffff, 1.6);
  rim.position.set(0.6, 0.5, -1);
  scene.add(hemi, key, rim);

  const rig = buildRig(THREE);
  scene.add(rig.root);
  let shownOpacity = -1;
  let shown = false;
  let side = 0;
  let ratio = 1;
  let at = "";
  let boxX = 0;
  let boxY = 0;
  let lastX = 0;
  let lastY = 0;

  function fit(size) {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    // even, so the box centres on a whole pixel
    const next = 2 * Math.ceil((size * BOX) / 2);
    if (next === side && renderer.getPixelRatio() === ratio) return;
    side = next;
    at = "";
    renderer.setPixelRatio(ratio);
    renderer.setSize(side, side);
  }

  return {
    kind: "webgl",
    canFly: true,
    setLook(look, palette, size) {
      rig.setLook(look, palette, size);
      fit(size);
    },
    resize() {
      at = "";
    },
    render(o, size, visible) {
      if (visible !== shown) {
        shown = visible;
        canvas.style.visibility = visible ? "visible" : "hidden";
        at = "";
      }
      if (!visible) return;
      fit(size);
      const op = Math.round(o.opacity * 1000) / 1000;
      if (op !== shownOpacity) {
        canvas.style.opacity = String(op);
        shownOpacity = op;
      }
      rig.apply(o, size);
      // The box stays put while the body is well inside it, and moves only when the bird nears its
      // edge, re-centred a little ahead of where it is going: each move restyles the canvas and
      // re-layers the page on the main thread, so a flight moves it every few frames and a bird on
      // its perch not at all. Snapped to device pixels; the camera looks at exactly that box, so
      // the bird keeps its sub-pixel position inside it.
      const cx = rig.root.position.x;
      const cy = -rig.root.position.y;
      const vx = cx - lastX;
      const vy = cy - lastY;
      lastX = cx;
      lastY = cy;
      const slack = size * SLACK;
      if (!at || Math.abs(cx - boxX) > slack || Math.abs(cy - boxY) > slack) {
        const lead = size * 0.8;
        boxX = cx + clamp(vx * 8, -lead, lead);
        boxY = cy + clamp(vy * 8, -lead, lead);
        const left = Math.round((boxX - side / 2) * ratio) / ratio;
        const top = Math.round((boxY - side / 2) * ratio) / ratio;
        camera.left = left;
        camera.right = left + side;
        camera.top = -top;
        camera.bottom = -top - side;
        camera.updateProjectionMatrix();
        at = `translate3d(${left}px, ${top}px, 0)`;
        canvas.style.transform = at;
      }
      renderer.render(scene, camera);
    },
    dispose() {
      rig.dispose();
      renderer.dispose();
      // give the context back now rather than at garbage collection; pages that recreate the
      // bird would otherwise run into the browser's limit on live WebGL contexts
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

// Rings of points, each running counter-clockwise around the direction the loft travels, joined
// into one closed, indexed surface. Indexed with no seam duplicates on purpose: the smooth vertex
// normals are what the line look's outline is pushed out along, and a seam would split it.
function loft(THREE, rings, start, end) {
  const n = rings[0].length;
  const pos = [];
  const index = [];
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      index.push(a, b, a + n, b, b + n, a + n);
    }
  }
  if (start) {
    const s = pos.length / 3;
    pos.push(...start);
    for (let j = 0; j < n; j++) index.push(s, (j + 1) % n, j);
  }
  if (end) {
    const e = pos.length / 3;
    const o = (rings.length - 1) * n;
    pos.push(...end);
    for (let j = 0; j < n; j++) index.push(e, o + j, o + ((j + 1) % n));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// An ellipsoid along x with few segments, so its facets show.
function ovoid(THREE, { a, b, c, segs = 10, rings = 8, tilt = 0 }) {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const rot = (x, y, z) => [x * ct - y * st, x * st + y * ct, z];
  const rs = [];
  for (let i = 1; i < rings; i++) {
    const s = -Math.cos((Math.PI * i) / rings);
    const k = Math.sqrt(1 - s * s);
    const ring = [];
    for (let j = 0; j < segs; j++) {
      const p = (j / segs) * TAU;
      ring.push(rot(s * a, b * k * Math.cos(p), c * k * Math.sin(p)));
    }
    rs.push(ring);
  }
  return loft(THREE, rs, rot(-a, 0, 0), rot(a, 0, 0));
}

const CHORD = [0, 0.12, 0.38, 0.7, 1];
const THICK = [0, 0.85, 1, 0.55, 0];
const CAMBER = [0, 0.6, 1, 0.75, 0];

// A wing panel lofted along its span (+z) from aerofoil sections: [z, leading x, trailing x,
// thickness, camber]. Thick at the leading edge, thin at the trailing edge, a little arched. The
// folded shape is the geometry; the flight shape is a morph target on the same vertices, so the
// wing changes planform as it opens. `outline` weights the line look's stroke per section.
function wingPanel(THREE, folded, flying, outline) {
  const build = ({ stations, tip }) => {
    const rings = stations.map(([z, le, te, t, c]) => {
      const pt = (i, side) => [le + (te - le) * CHORD[i], c * CAMBER[i] + (side * t * THICK[i]) / 2, z];
      return [pt(0, 0), pt(1, 1), pt(2, 1), pt(3, 1), pt(4, 0), pt(3, -1), pt(2, -1), pt(1, -1)];
    });
    const [z0, le0, te0] = stations[0];
    return loft(THREE, rings, [(le0 + te0) / 2, 0, z0 - 0.25], tip);
  };
  const geo = build(folded);
  const fly = build(flying);
  geo.morphAttributes.position = [fly.getAttribute("position")];
  // The normals only steer the line look's outline (porcelain is flat shaded from the surface
  // itself), and the outline is only drawn on an open wing, so they come from the flight shape.
  // At the paper-thin leading and trailing edges an averaged normal points mostly up or down and
  // the stroke there thins to dashes; pushing those edges straight out in the wing's plane keeps
  // the stroke whole.
  const normal = fly.getAttribute("normal");
  const st = flying.stations;
  const edge = (i, k, sign, vertex) => {
    const a = st[Math.max(0, i - 1)];
    const b = st[Math.min(st.length - 1, i + 1)];
    const dx = b[k] - a[k];
    const dz = b[0] - a[0];
    const len = Math.hypot(dx, dz) || 1;
    normal.setXYZ(vertex, (sign * dz) / len, 0, (-sign * dx) / len);
  };
  const ring = CHORD.length * 2 - 2;
  for (let i = 0; i < st.length; i++) {
    edge(i, 1, 1, i * ring);
    edge(i, 2, -1, i * ring + 4);
  }
  if (flying.tip) {
    const [, le, te] = st[st.length - 1];
    const dx = flying.tip[0] - (le + te) / 2;
    const dz = flying.tip[2] - st[st.length - 1][0];
    const len = Math.hypot(dx, dz) || 1;
    normal.setXYZ(normal.count - 1, dx / len, 0, dz / len);
  }
  geo.setAttribute("normal", normal);
  const w = [];
  for (const k of outline) for (let j = 0; j < CHORD.length * 2 - 2; j++) w.push(k);
  w.push(outline[0]);
  if (folded.tip) w.push(1);
  geo.setAttribute("hullw", new THREE.Float32BufferAttribute(w, 1));
  return geo;
}

// The arm carries the secondaries; the hand, the primaries, is longer and tapers to a rounded
// point, with a faintly stepped trailing edge where the flight feathers separate. Folded, both
// are broad (chords shorten further as they fold); spread, they are the narrow, long wing of a
// small bird in flight.
const INNER = {
  stations: [
    [0, 0.75, -3.9, 0.7, 0.15],
    [1.5, 0.8, -4.3, 0.6, 0.2],
    [3.0, 0.7, -4.3, 0.5, 0.2],
    [4.4, 0.5, -4.1, 0.45, 0.18],
  ],
};
const INNER_FLY = {
  stations: [
    [0, 0.6, -3.3, 0.55, 0.14],
    [1.6, 0.62, -3.45, 0.5, 0.16],
    [3.2, 0.55, -3.3, 0.45, 0.16],
    [4.7, 0.4, -3.05, 0.4, 0.14],
  ],
};
const L1 = 4.4;
const ELBOW_FLY = 4.6;
const OUTER = {
  stations: [
    [-0.3, 0.55, -4.0, 0.42, 0.18],
    [1.4, 0.5, -4.0, 0.36, 0.16],
    [2.7, 0.32, -3.6, 0.3, 0.13],
    [3.5, 0.15, -3.62, 0.27, 0.12],
    [4.7, -0.22, -3.0, 0.22, 0.1],
    [5.4, -0.45, -2.95, 0.18, 0.08],
    [6.4, -0.85, -2.25, 0.12, 0.05],
  ],
  tip: [-1.15, 0, 7.4],
};
const OUTER_FLY = {
  stations: [
    [-0.3, 0.42, -3.05, 0.38, 0.14],
    [1.6, 0.36, -2.95, 0.33, 0.13],
    [3.2, 0.18, -2.6, 0.28, 0.11],
    [4.6, -0.08, -2.66, 0.23, 0.09],
    [5.9, -0.48, -2.2, 0.18, 0.07],
    [7.1, -0.95, -2.06, 0.12, 0.04],
    [8.0, -1.35, -1.85, 0.08, 0.02],
  ],
  tip: [-1.62, 0, 8.75],
};
// No stroke where the arm is inside the body: an outline there pokes through the body's surface
// as stray fragments.
const INNER_LINE = [0, 0, 1, 1];
const OUTER_LINE = [1, 1, 1, 1, 1, 1, 1];

// The tail runs along -x from its root: [x, half width, half thickness]. Square at the end, and
// wider there when fanned (a morph target, so the outline hull fans with it).
function tailGeometry(THREE) {
  const build = (fan) => {
    const stations = [
      [-5.6, 1.85, 0.6],
      [-4.0, 1.55, 0.68],
      [-2.0, 1.25, 0.8],
      [0, 1.0, 0.9],
    ];
    const rings = stations.map(([x, w0, t]) => {
      const w = w0 * (1 + fan * 0.85 * (-x / 5.6));
      return [
        [x, t, 0], [x, 0.45 * t, 0.75 * w], [x, 0, w], [x, -0.4 * t, 0.75 * w],
        [x, -t, 0], [x, -0.4 * t, -0.75 * w], [x, 0, -w], [x, 0.45 * t, -0.75 * w],
      ];
    });
    return loft(THREE, rings, [-5.6, 0, 0], [0.4, 0, 0]);
  };
  const geo = build(0);
  geo.morphAttributes.position = [build(1).getAttribute("position")];
  return geo;
}

// Body and nape in one piece, lofted along an axis tilted up toward the head. The rings are slices
// of the mark's silhouette (a round body plus the fill between it and the head, fitted to the mark's
// outline): [distance along the axis, offset across it, half-height]. One surface rather than
// stacked balls, so the bird reads as one animal and not a snowman.
const TORSO_O = [0.83, 8.0];
const TORSO_TILT = 0.9;
const TORSO = [
  [-4.28, 0.04, 1.52], [-3.53, 0.03, 2.86], [-2.36, 0.02, 3.88], [-0.89, 0.01, 4.45], [0.74, 0, 4.48],
  [2.38, 0.23, 4.11], [3.85, 0.51, 3.6], [5.02, 0.43, 2.79], [5.77, 0.38, 1.52],
];
function torsoGeometry(THREE) {
  const c = Math.cos(TORSO_TILT);
  const sn = Math.sin(TORSO_TILT);
  // songbirds are a little narrower than they are deep, and narrower again at the neck
  const width = (s) => lerp(0.82, 0.68, smooth(1.5, 5.8, s));
  const at = (s, n, z) => [s * c - n * sn, s * sn + n * c, z];
  const rings = TORSO.map(([s, n, r]) =>
    Array.from({ length: 10 }, (_, j) => {
      const p = (j / 10) * TAU;
      return at(s, n + r * Math.cos(p), r * width(s) * Math.sin(p));
    }),
  );
  return loft(THREE, rings, at(-4.54, 0.04, 0), at(6.02, 0.36, 0));
}

function beakGeometry(THREE) {
  const ring = (x, k) =>
    Array.from({ length: 6 }, (_, j) => {
      const p = (j / 6) * TAU;
      return [x, 0.8 * k * Math.cos(p), 0.66 * k * Math.sin(p)];
    });
  return loft(THREE, [ring(0, 1), ring(0.9, 0.84), ring(1.75, 0.52), ring(2.35, 0.24)], [-0.3, 0, 0], [2.75, -0.06, 0]);
}

// Unit-radius pieces, scaled per frame: a tarsus one unit long down -y, and a foot along x.
function legGeometry(THREE) {
  const ring = (y, r) =>
    Array.from({ length: 6 }, (_, j) => {
      const p = (j / 6) * TAU;
      return [r * Math.cos(p), y, r * Math.sin(p)];
    });
  return loft(THREE, [ring(0, 1), ring(-1, 0.85)], [0, 0.2, 0], [0, -1.05, 0]);
}

function toeGeometry(THREE) {
  const ring = (x, r) =>
    Array.from({ length: 5 }, (_, j) => {
      const p = (j / 5) * TAU;
      return [x, r * Math.cos(p), r * Math.sin(p)];
    });
  return loft(THREE, [ring(-0.7, 0.8), ring(0, 1), ring(1.0, 0.8)], [-0.9, 0, 0], [1.25, 0, 0]);
}

// The line look's outline is an inverted hull: the same mesh drawn again, back faces only,
// pushed out along its normals by the stroke width. Wherever the fill is in front it hides the
// hull, so only a band around the silhouette shows — and where head, beak and body overlap their
// hulls hide each other, which leaves one outline around the whole bird, as the mark has.
// The camera's depth range, which the outline's depth bias below is expressed in.
const NEAR = 1;
const FAR = 2000;

function hullMaterial(THREE, uniform, bias, weighted) {
  const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHull = uniform;
    shader.uniforms.uBias = bias;
    const w = weighted ? " * hullw" : "";
    shader.vertexShader = `uniform float uHull;\nuniform float uBias;\n${weighted ? "attribute float hullw;\n" : ""}${shader.vertexShader}`
      .replace("#include <project_vertex>", `transformed += normalize(normal) * uHull${w};\n#include <project_vertex>`)
      // Pushed back by about a stroke width, so an outline only shows where it is clear of every
      // surface in front of it: a sliver of shell barely poking through the body (a wing root,
      // the head's rim against the back) is hidden rather than drawn as a broken hairline.
      .replace("#include <fog_vertex>", "gl_Position.z += uBias * gl_Position.w;\n#include <fog_vertex>");
  };
  m.customProgramCacheKey = () => (weighted ? "hull-weighted" : "hull");
  return m;
}

function buildRig(THREE) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.position.y = -PIVOT;
  root.add(model);
  const body = new THREE.Group();
  body.position.set(HIP[0], HIP[1], 0);
  model.add(body);
  const torso = new THREE.Group();
  torso.position.set(-HIP[0], -HIP[1], 0);
  body.add(torso);

  const mats = {
    body: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.55, metalness: 0 }),
    wing: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6, metalness: 0 }),
    beak: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.45, metalness: 0 }),
    leg: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6, metalness: 0 }),
    eye: new THREE.MeshStandardMaterial({ roughness: 0.18, metalness: 0 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    fill: new THREE.MeshBasicMaterial(),
    stroke: new THREE.MeshBasicMaterial(),
  };
  const hullBody = { value: 0 };
  const hullWing = { value: 0 };
  const hullBias = { value: 0 };
  const hulls = {
    body: hullMaterial(THREE, hullBody, hullBias),
    bodyMorph: hullMaterial(THREE, hullBody, hullBias),
    wing: hullMaterial(THREE, hullWing, hullBias, true),
  };
  const parts = [];
  const geos = [];

  function add(geo, role, parent, x = 0, y = 0, z = 0) {
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mats[role]);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    parent.add(mesh);
    let hull = null;
    const morph = !!geo.morphAttributes.position;
    if (role === "body" || role === "wing" || role === "beak") {
      hull = new THREE.Mesh(geo, role === "wing" ? hulls.wing : morph ? hulls.bodyMorph : hulls.body);
      hull.frustumCulled = false;
      mesh.add(hull);
    }
    parts.push({ mesh, hull, role, morph });
    return mesh;
  }

  // A material drawn both with and without morph targets has its shader program swapped, and
  // three.js re-derives which one on every draw; a morphing mesh gets a twin of its material so
  // each keeps the one program it needs.
  const twins = new Map();
  function twinOf(m) {
    let t = twins.get(m);
    if (!t) {
      t = m.clone();
      twins.set(m, t);
    }
    t.color.copy(m.color);
    return t;
  }

  const trunk = add(torsoGeometry(THREE), "body", torso, TORSO_O[0], TORSO_O[1]);

  const neck = new THREE.Group();
  neck.position.set(NECK[0], NECK[1], 0);
  torso.add(neck);
  add(ovoid(THREE, { a: 2.8, b: 2.64, c: 2.45, segs: 10, rings: 8, tilt: -0.355 }), "body", neck, 1.38, 1.26);
  const beak = add(beakGeometry(THREE), "beak", neck, 3.45, 1.05);
  beak.rotation.z = -0.1;
  const eyes = [1, -1].map((side) => {
    const eye = add(ovoid(THREE, { a: 0.58, b: 0.58, c: 0.58, segs: 8, rings: 6 }), "eye", neck, 2.15, 2.1, 1.9 * side);
    add(ovoid(THREE, { a: 0.15, b: 0.15, c: 0.15, segs: 6, rings: 4 }), "shine", eye, 0.2, 0.24, 0.45 * side);
    eye.userData.side = side;
    return eye;
  });

  const tail = new THREE.Group();
  tail.position.set(TAIL_ROOT[0], TAIL_ROOT[1], 0);
  torso.add(tail);
  const tailMesh = add(tailGeometry(THREE), "body", tail);
  tailMesh.morphTargetInfluences = [0];
  const tailHull = parts[parts.length - 1].hull;
  tailHull.morphTargetInfluences = [0];

  // Folded, the wing lies along the bird's side: the arm runs back along the round flank with
  // its leading edge on top, the hand angles in so its tip crosses over the tail as a songbird's
  // primaries do. Both are given as a span direction plus an "up" for the leading edge, in body
  // space, measured against the torso's surface. The panels' chords also shorten as they fold,
  // the way feathers stack, which keeps the folded wing inside the body's outline.
  const fold = (span, up) => {
    const z = span.normalize();
    const x = up.addScaledVector(z, -up.dot(z)).normalize();
    const y = V(0, 0, 0).crossVectors(z, x);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  const Q_FOLD = fold(V(-0.82, -0.56, -0.05), V(0, 1, -0.18));
  const Q_OUTER_FOLD = Q_FOLD.clone().invert().multiply(fold(V(-0.86, -0.42, -0.36), V(0, 1, -0.3)));
  const IDENT = new THREE.Quaternion();
  const SH_FOLD = V(1.6, 10.85, 3.15);
  const SH_SPREAD = V(1.0, 10.4, 1.4);

  const wings = [1, -1].map((side) => {
    const mirror = new THREE.Group();
    mirror.scale.z = side;
    torso.add(mirror);
    const shoulder = new THREE.Group();
    mirror.add(shoulder);
    const inner = add(wingPanel(THREE, INNER, INNER_FLY, INNER_LINE), "wing", shoulder);
    const elbow = new THREE.Group();
    shoulder.add(elbow);
    const outer = add(wingPanel(THREE, OUTER, OUTER_FLY, OUTER_LINE), "wing", elbow);
    for (const mesh of [inner, outer, inner.children[0], outer.children[0]]) mesh.morphTargetInfluences = [0];
    return { shoulder, elbow, inner, outer };
  });

  // Staggered along the branch like the mark's two tarsi, angled so the feet land under the
  // centre of mass. [hip in torso space, foot on the branch]
  const legs = [
    [V(2.15, 4.4, 0.7), V(1.6, 0, 0.55)],
    [V(-0.85, 4.6, -0.7), V(-1.6, 0, -0.55)],
  ].map(([hip, foot]) => ({
    hip,
    foot,
    leg: add(legGeometry(THREE), "leg", model),
    toes: add(toeGeometry(THREE), "leg", model),
  }));

  const X = V(1, 0, 0);
  const Y = V(0, 1, 0);
  const Z = V(0, 0, 1);
  const DOWN = V(0, -1, 0);
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const m = new THREE.Matrix4();
  const v = V(0, 0, 0);
  const hipM = V(0, 0, 0);
  const airFoot = V(0, 0, 0);
  const foot = V(0, 0, 0);
  let lineLook = false;
  let stroke = 2;

  function setLook(look, palette, size) {
    lineLook = look === "line";
    const scale = size / LENGTH;
    if (lineLook) {
      mats.fill.color.set(palette.fill);
      mats.stroke.color.set(palette.stroke);
      hulls.body.color.set(palette.stroke);
      hulls.bodyMorph.color.set(palette.stroke);
      hulls.wing.color.set(palette.stroke);
      stroke = palette.strokeWidth ?? clamp(size * 0.034, 1.25, 3);
      hullBody.value = stroke / scale;
      hullBias.value = (1.5 * stroke * 2) / (FAR - NEAR);
    } else {
      mats.body.color.set(palette.body);
      mats.wing.color.set(palette.wing);
      mats.beak.color.set(palette.beak);
      mats.leg.color.set(palette.beak);
      mats.eye.color.set(palette.eye);
    }
    for (const p of parts) {
      const m = lineLook ? (p.role === "eye" || p.role === "leg" ? mats.stroke : mats.fill) : mats[p.role];
      p.mesh.material = p.morph ? twinOf(m) : m;
      p.mesh.visible = !(lineLook && p.role === "shine");
      if (p.hull) p.hull.visible = lineLook;
    }
  }

  function apply(o, size) {
    const scale = size / LENGTH;
    root.scale.setScalar(scale);
    eul.set(o.roll, o.yaw, o.pitch, "YZX");
    q.setFromEuler(eul);
    q2.setFromAxisAngle(X, o.view);
    root.quaternion.multiplyQuaternions(q2, q);
    v.set(0, -PIVOT * scale, 0).applyQuaternion(root.quaternion);
    const ax = o.x;
    const ay = -o.y + o.lift;
    root.position.set(lerp(ax, ax - v.x, o.planted), lerp(ay + PIVOT * scale, ay - v.y, o.planted), 0);

    body.position.set(HIP[0], HIP[1] - o.crouch * 1.2, 0);
    body.rotation.z = o.lean;
    trunk.scale.set(
      1 + o.ruffle * 0.04,
      1 + o.breath * 0.012 + o.ruffle * 0.05,
      1 + o.breath * 0.025 + o.ruffle * 0.08,
    );
    eul.set(o.headRoll, o.headYaw, o.headPitch, "YZX");
    neck.quaternion.setFromEuler(eul);

    tail.rotation.z = TAIL_DOWN - o.tailPitch;
    tailMesh.morphTargetInfluences[0] = o.tailFan;
    tailHull.morphTargetInfluences[0] = o.tailFan;

    // Spread wings are drawn a little larger than life: true to scale, a songbird's wing reads as
    // a flicker at this size. In the line look a wing's outline draws itself in as it opens, and a
    // folded wing is left out altogether: the mark has no wing, and a background-coloured one
    // would nick the body's outline where it overlaps it.
    const reach = lerp(1, 1.08, o.spread);
    const planform = smooth(0.25, 0.9, o.spread);
    const wingLine = smooth(0.2, 0.32, o.spread);
    hullWing.value = (stroke / scale / reach) * wingLine;
    for (const w of wings) {
      w.inner.visible = w.outer.visible = !lineLook || wingLine > 0.01;
      w.shoulder.scale.setScalar(reach);
      w.shoulder.position.lerpVectors(SH_FOLD, SH_SPREAD, o.spread);
      q.slerpQuaternions(Q_FOLD, IDENT, o.spread);
      q.multiply(q2.setFromAxisAngle(Z, o.twist));
      q.premultiply(q2.setFromAxisAngle(Y, o.sweep));
      q.premultiply(q2.setFromAxisAngle(X, -o.elev));
      w.shoulder.quaternion.copy(q);
      w.inner.morphTargetInfluences[0] = w.inner.children[0].morphTargetInfluences[0] = planform;
      w.outer.morphTargetInfluences[0] = w.outer.children[0].morphTargetInfluences[0] = planform;
      w.inner.scale.x = lerp(0.8, 1, o.spread);
      w.outer.scale.x = lerp(0.5, 1, o.spread);
      w.elbow.position.set(0, 0.22 * (1 - o.spread), lerp(L1 - 1.2, lerp(L1 - 0.1, ELBOW_FLY, planform), o.spread));
      q.slerpQuaternions(Q_OUTER_FOLD, IDENT, o.spread);
      q.multiply(q2.setFromAxisAngle(X, o.outerBend));
      q.multiply(q2.setFromAxisAngle(Y, -o.outerSweep));
      w.elbow.quaternion.copy(q);
    }

    // Legs are solved, not posed: each runs from its hip (wherever the body has crouched or
    // leant to) to its foot, which is on the branch when perched and tucked under the body in flight.
    body.updateMatrix();
    torso.updateMatrix();
    m.multiplyMatrices(body.matrix, torso.matrix);
    const legR = lineLook ? stroke / 2 / scale : 0.24;
    const toeR = lineLook ? stroke / 2 / scale : 0.2;
    for (const L of legs) {
      hipM.copy(L.hip).applyMatrix4(m);
      airFoot.set(L.hip.x - 1.5, L.hip.y - 1.5, L.hip.z).applyMatrix4(m);
      foot.copy(L.foot).lerp(airFoot, o.legAir);
      v.subVectors(foot, hipM);
      const len = v.length() || 1e-3;
      v.divideScalar(len);
      L.leg.position.copy(hipM);
      L.leg.quaternion.setFromUnitVectors(DOWN, v);
      L.leg.scale.set(legR, len, legR);
      L.toes.position.copy(foot);
      L.toes.quaternion.setFromAxisAngle(Z, -1.3 * o.legAir);
      L.toes.scale.set(1 - 0.45 * o.legAir, toeR, toeR);
    }

    // An eye on the far side of the head sinks into it as it turns away from the viewer, rather
    // than poking out past the head's outline in a three-quarter view.
    root.updateMatrixWorld();
    neck.getWorldQuaternion(q);
    for (const eye of eyes) {
      const facing = v.set(0, 0, eye.userData.side).applyQuaternion(q).z;
      const k = smooth(-0.1, 0.3, facing);
      eye.visible = k > 0.01;
      eye.scale.set(k, k * (1 - 0.88 * o.blink), k);
    }
  }

  function dispose() {
    for (const g of geos) g.dispose();
    for (const mat of Object.values(mats)) mat.dispose();
    for (const t of twins.values()) t.dispose();
    hulls.body.dispose();
    hulls.bodyMorph.dispose();
    hulls.wing.dispose();
  }

  return { root, apply, setLook, dispose };
}

function createSVGView(container, zIndex) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  Object.assign(svg.style, {
    position: "fixed",
    left: "0",
    top: "0",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: String(zIndex),
    transformOrigin: "0 0",
    opacity: "0",
  });
  const legs = document.createElementNS(SVG_NS, "path");
  legs.setAttribute("d", MARK_LEGS);
  legs.setAttribute("fill", "none");
  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("d", MARK_BODY);
  const eye = document.createElementNS(SVG_NS, "circle");
  eye.setAttribute("cx", "16.4");
  eye.setAttribute("cy", "6.9");
  eye.setAttribute("r", ".65");
  for (const p of [legs, body]) {
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  }
  svg.append(legs, body, eye);
  container.appendChild(svg);
  let strokePx = 2;

  return {
    kind: "svg",
    canFly: false,
    setLook(look, palette, size) {
      const k = size / LENGTH;
      if (look === "line") {
        strokePx = palette.strokeWidth ?? clamp(size * 0.034, 1.25, 3);
        body.setAttribute("fill", palette.fill);
        body.setAttribute("stroke", palette.stroke);
        legs.setAttribute("stroke", palette.stroke);
        eye.setAttribute("fill", palette.stroke);
      } else {
        strokePx = 1.5 * k;
        body.setAttribute("fill", palette.body);
        body.setAttribute("stroke", palette.body);
        legs.setAttribute("stroke", palette.beak);
        eye.setAttribute("fill", palette.eye);
      }
      const units = String(strokePx / k);
      body.setAttribute("stroke-width", units);
      legs.setAttribute("stroke-width", units);
    },
    resize() {},
    render(o, size) {
      const k = size / LENGTH;
      svg.style.opacity = String(o.opacity);
      svg.style.transform = `translate(${o.x}px, ${o.y - o.lift}px) scale(${o.dir * k}, ${k}) translate(-12.6px, -20px)`;
    },
    dispose() {
      svg.remove();
    },
  };
}
