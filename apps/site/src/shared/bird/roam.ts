import type { Bird, BirdFacing, ViaPoint } from "./bird";
import { isHeld, onRelease } from "./hold";

/** A stretch of an element's top edge the bird may stand anywhere along. */
export type RoamEdge = {
  el: Element;
  /** 0..1 along the edge. Default 0. */
  from?: number;
  /** 0..1 along the edge. Default 1. */
  to?: number;
  /** Lowers the edge, as for a perch. */
  offsetY?: number;
  facing?: BirdFacing;
};

/** One stretch of the page, usually a section: the perches in it and the text it must keep off. */
export type RoamZone = {
  /** The zone's main perch: where it is on the page, and the only perch under reduced motion. */
  home: RoamEdge & { at: number };
  /** The other edges it may stand on, read when the bird next decides where to go. */
  edges?: () => RoamEdge[];
  /** Viewport rects it must never stand in front of: the text being read. */
  avoid?: () => Iterable<Rect>;
  /** A window to fly a lap around now and then. */
  around?: () => Element | null;
  /** The share of moves that end on the home edge. Default 0.2. */
  homing?: number;
};

export type RoamOptions = {
  /** In page order. */
  zones: RoamZone[];
  /** Flights stay below this element and perches clear of it: a sticky nav. */
  ceiling?: Element | null;
  seed?: number;
};

type Rect = { left: number; top: number; right: number; bottom: number };
type Point = { x: number; y: number };
type Spot = Point & { zone: number; edge: RoamEdge; at: number };
type Kind = "shuffle" | "arc" | "loop" | "glide" | "lap";
type Flight = { via?: ViaPoint[]; pace?: number; facing?: BirdFacing };

const KINDS: [Kind, number][] = [
  ["shuffle", 0.26],
  ["arc", 0.3],
  ["loop", 0.18],
  ["glide", 0.14],
  ["lap", 0.12],
];
// A bird a reader is scrolling with: it re-perches once the page has carried it this share of the
// view, even when its perch is still in the open.
const DRIFT = 0.3;
// Mid-flight, a fresh pick may bend the path at most this often (ms), so a fling is one flight.
const BEND_MS = 300;
const CHECK_MS = 120;
// How far ahead (s) the scroll is projected: take-off plus the first moments of the climb.
const LOOKAHEAD_S = 0.45;
const LAP_EVERY_MS = 14000;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Keeps the bird busy around the part of the page being read. It follows the reader at once as they
 * scroll, and between scrolls never sits more than a few seconds: it shuffles along its branch, or
 * takes off for a lazy arc, a loop, a glide down or a lap round the zone's window, and lands on
 * another perch in the open part of the view. Everything is drawn from one seeded random, so no
 * two minutes look alike. Under reduced motion, or with the SVG fallback that cannot fly, it only
 * keeps to each zone's home perch. Returns stop().
 */
export function roam(bird: Bird, { zones, ceiling = null, seed }: RoamOptions): () => void {
  const first = zones[0];
  if (!first) return () => {};
  const zoneAt = (i: number): RoamZone => zones[i] ?? first;
  const rand = seeded(seed ?? Math.floor(Math.random() * 2 ** 32));
  const recent: Kind[] = [];
  let target: Spot | null = null;
  let homeZone = -1;
  let hops = 0;
  let timer = 0;
  let recheck = 0;
  let frame = 0;
  let decidedY = scrollY;
  let bentAt = -Infinity;
  let checkedAt = -Infinity;
  let lapAt = -Infinity;
  let live = true;
  bird.setCeiling(ceiling);

  const still = () => bird.reducedMotion || bird.renderer === "svg";
  const top = () => (ceiling?.isConnected ? ceiling.getBoundingClientRect().bottom : 0);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const rest = () => 1.3 + 2.1 * rand() ** 1.3;

  function pointOn(edge: RoamEdge, at: number): Point | null {
    if (!edge.el.isConnected) return null;
    const r = edge.el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    // as the bird does: feet kept clear of the ends of the edge
    const inset = Math.min(r.width / 2, bird.size * 0.22);
    return { x: clamp(r.left + at * r.width, r.left + inset, r.right - inset), y: r.top + (edge.offsetY ?? 0) };
  }

  /** Room for the bird standing at p: under the nav, inside the view, and off the text. */
  function fits(p: Point, avoid: Rect[]): boolean {
    const s = bird.size;
    if (p.y - s < top() + 6 || p.y > innerHeight - s * 0.35) return false;
    if (p.x < s * 0.6 || p.x > innerWidth - s * 0.6) return false;
    const l = p.x - s * 0.6;
    const r = p.x + s * 0.6;
    const t = p.y - s;
    // A line box is mostly air above the letters, so a bird may stand on the cap line of a heading.
    return !avoid.some(
      (a) => a.right + 3 > l && a.left - 3 < r && a.bottom + 3 > t && a.top + (a.bottom - a.top) * 0.3 < p.y + 2,
    );
  }

  function edgesOf(zi: number): RoamEdge[] {
    const zone = zoneAt(zi);
    return [zone.home, ...(zone.edges?.() ?? [])];
  }

  function spotsIn(zi: number, avoid: Rect[]): Spot[] {
    const out: Spot[] = [];
    const s = bird.size;
    for (const edge of edgesOf(zi)) {
      if (!edge.el.isConnected) continue;
      const width = edge.el.getBoundingClientRect().width;
      const from = edge.from ?? 0;
      const to = edge.to ?? 1;
      const n = clamp(Math.round(((to - from) * width) / (s * 1.4)), 1, 9);
      for (let i = 0; i < n; i++) {
        const at = from + ((to - from) * (i + 0.5)) / n;
        const p = pointOn(edge, at);
        if (p && fits(p, avoid)) out.push({ ...p, zone: zi, edge, at });
      }
    }
    return out;
  }

  const inView = (zi: number) => {
    const y = zoneAt(zi).home.el.getBoundingClientRect().top;
    return y > -innerHeight && y < innerHeight * 2;
  };

  function avoidNow(): Rect[] {
    const out: Rect[] = [];
    zones.forEach((zone, zi) => {
      if (zone.avoid && inView(zi)) for (const r of zone.avoid()) out.push(r);
    });
    return out;
  }

  /** The zone being read: the last whose home has come up past this line. */
  function activeZone(): number {
    const line = top() + (innerHeight - top()) * 0.62;
    let active = 0;
    zones.forEach((zone, zi) => {
      if (zone.home.el.isConnected && zone.home.el.getBoundingClientRect().top <= line) active = zi;
    });
    return active;
  }

  /** Spots in the active zone, or failing that in the zones beside it that are in view. */
  function pool(zi: number, avoid: Rect[]): Spot[] {
    const own = spotsIn(zi, avoid);
    if (own.length >= 2) return own;
    const near = [zi + 1, zi - 1].filter((z) => z >= 0 && z < zones.length).flatMap((z) => spotsIn(z, avoid));
    return own.concat(near);
  }

  function go(spot: Spot, flight: Flight = {}) {
    target = spot;
    decidedY = scrollY;
    bentAt = performance.now();
    clearTimeout(timer);
    timer = 0;
    bird
      .perchOn(spot.edge.el, {
        at: spot.at,
        offsetY: spot.edge.offsetY,
        facing: flight.facing ?? spot.edge.facing,
        via: flight.via,
        pace: flight.pace,
      })
      .catch(() => undefined);
  }

  function schedule(seconds: number) {
    clearTimeout(timer);
    timer = window.setTimeout(wander, seconds * 1000);
  }

  // Via points are tied to an element, so a path drawn now scrolls with the page.
  function tie(el: Element, p: Point): ViaPoint {
    const s = bird.size;
    const x = clamp(p.x, s * 0.8, innerWidth - s * 0.8);
    const y = clamp(p.y, top() + s * 1.15, innerHeight - s * 0.6);
    const r = el.getBoundingClientRect();
    return { el, x: x - r.left, y: y - r.top };
  }

  function shuffle(from: Spot, avoid: Rect[]): boolean {
    const width = from.edge.el.getBoundingClientRect().width;
    const step = ((0.35 + rand() * 0.65) * bird.size) / Math.max(1, width);
    const lo = from.edge.from ?? 0;
    const hi = from.edge.to ?? 1;
    const first = rand() < 0.5 ? 1 : -1;
    for (const sign of [first, -first]) {
      const at = from.at + sign * step;
      if (at < lo || at > hi) continue;
      const p = pointOn(from.edge, at);
      if (!p || !fits(p, avoid)) continue;
      // a bird hops the way it is going to face
      go({ ...p, zone: from.zone, edge: from.edge, at }, { facing: sign > 0 ? "right" : "left" });
      return true;
    }
    return false;
  }

  function chooseKind(spots: Spot[]): Kind {
    const repeats = (k: Kind) => recent.filter((r) => r === k).length;
    // on a single edge (the install command at the foot of the page) loops make up for the flights
    const narrow = new Set(spots.map((p) => p.edge.el)).size < 2;
    const weights = KINDS.map(([kind, w]): [Kind, number] => {
      if (kind === "loop" && narrow) w *= 2.5;
      if (kind === "shuffle" && recent.at(-1) === "shuffle") return [kind, w * 0.25];
      if (kind === "lap" && performance.now() - lapAt < LAP_EVERY_MS) return [kind, 0];
      return [kind, w / (1 + repeats(kind))];
    });
    let r = rand() * weights.reduce((sum, [, w]) => sum + w, 0);
    for (const [kind, w] of weights) if ((r -= w) <= 0) return kind;
    return "arc";
  }

  /** A destination for a flight: not too close, not too far, and now and then home. */
  function destination(from: Point, spots: Spot[], zi: number): Spot | null {
    const s = bird.size;
    const away = spots.filter((p) => Math.hypot(p.x - from.x, p.y - from.y) > s * 1.6);
    if (!away.length) return null;
    const home = away.filter((p) => p.edge === zoneAt(zi).home);
    if (home.length && rand() < (zoneAt(zi).homing ?? 0.2)) return pick(home) ?? null;
    const openTop = top() + (innerHeight - top()) * 0.12;
    const weights = away.map((p) => {
      const d = Math.hypot(p.x - from.x, p.y - from.y) / s;
      return (p.zone === zi ? 1 : 0.35) * (p.y < openTop ? 0.3 : 1) * (d > 9 ? 9 / d : 1) * (0.5 + rand());
    });
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (const [i, p] of away.entries()) if ((r -= weights[i] ?? 0) <= 0) return p;
    return away[0] ?? null;
  }

  // How much of a path drawn through these points crosses text or leaves the open view.
  function crowding(points: Point[], avoid: Rect[]): number {
    const s = bird.size;
    let hits = 0;
    for (const p of points) {
      if (p.y - s < top() || p.y > innerHeight - s * 0.4 || p.x < s * 0.6 || p.x > innerWidth - s * 0.6) hits++;
      else if (avoid.some((a) => p.x > a.left - s * 0.6 && p.x < a.right + s * 0.6 && p.y > a.top && p.y - s < a.bottom)) hits++;
    }
    return hits;
  }

  // Points along a polyline, for scoring a path by crowding().
  function along(points: Point[], each = 4): Point[] {
    const out: Point[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as Point;
      const b = points[i] as Point;
      for (let k = 1; k <= each; k++) out.push({ x: a.x + ((b.x - a.x) * k) / each, y: a.y + ((b.y - a.y) * k) / each });
    }
    return out;
  }

  // A lazy circle, seen from above and in front: a flattened ellipse. Of a few places for it, the
  // one whose path keeps clearest of the text and inside the open view.
  function loopVia(from: Point, to: Spot, avoid: Rect[]): ViaPoint[] {
    const s = bird.size;
    const R = s * (2.2 + rand() * 1.2);
    const ry = R * (0.36 + rand() * 0.14);
    const away = to.x >= from.x ? -1 : 1;
    let best: Point[] = [];
    let score = Infinity;
    for (const out of [away, -away]) {
      for (const lift of [1.2 + rand() * 0.8, -0.4]) {
        const cx = clamp(from.x + out * R * 0.9, R + s, innerWidth - R - s);
        const cy = Math.min(from.y, to.y) - s * lift;
        const a0 = Math.atan2((from.y - cy) / ry, (from.x - cx) / R);
        // round whichever way rises first
        const turn = Math.sin(a0 + Math.PI / 2) < Math.sin(a0 - Math.PI / 2) ? 1 : -1;
        const at = (k: number) => ({ x: cx + R * Math.cos(a0 + turn * k), y: cy + ry * Math.sin(a0 + turn * k) });
        const ring = [1, 2, 3].map((k) => at((k * Math.PI) / 2));
        const samples = [
          ...Array.from({ length: 12 }, (_, i) => at(((i + 1) * Math.PI) / 6)),
          ...along([from, ring[0] as Point], 3),
          ...along([ring[2] as Point, to], 3),
        ];
        // a little preference for the loop out to the side away from the perch it lands on
        const c = crowding(samples, avoid) + (out === away ? 0 : 0.5) + rand() * 0.4;
        if (c < score) [best, score] = [ring, c];
      }
    }
    return best.map((p) => tie(to.edge.el, p));
  }

  // Wingbeats up to a high point, then a long glide down onto the perch; the high point goes to
  // whichever side has the clearer air.
  function glideVia(from: Point, to: Spot, avoid: Rect[]): ViaPoint[] {
    const s = bird.size;
    const rise = s * (1.4 + rand() * 0.8);
    const options = [0.22, -0.3].map((k) => ({ x: from.x + (to.x - from.x) * k, y: from.y - rise }));
    const pick = options.reduce((a, b) => (crowding([b], avoid) < crowding([a], avoid) ? b : a));
    return [tie(to.edge.el, pick)];
  }

  /** Down one side of the window, across its lower part and up the other, to a perch at the end. */
  function lap(from: Point, zi: number, spots: Spot[], avoid: Rect[]): boolean {
    const win = zoneAt(zi).around?.();
    if (!win?.isConnected) return false;
    const r = win.getBoundingClientRect();
    const s = bird.size;
    const y0 = Math.max(r.top + s * 0.4, top() + s * 1.2);
    const y1 = Math.min(r.bottom - s * 0.5, innerHeight - s);
    if (y1 - y0 < s * 3) return false;
    const left = Math.max(r.left - s * 0.7, s * 0.8);
    const right = Math.min(r.right + s * 0.7, innerWidth - s * 0.8);
    const first = from.x < (r.left + r.right) / 2 ? left : right;
    const last = first === left ? right : left;
    const end = { x: last, y: r.top };
    const to = spots
      .filter((p) => Math.abs(p.y - r.top) < s * 4)
      .sort((a, b) => Math.hypot(a.x - end.x, a.y - end.y) - Math.hypot(b.x - end.x, b.y - end.y))[0];
    if (!to) return false;
    const low = y0 + (y1 - y0) * (0.65 + rand() * 0.25);
    const path = [
      { x: first, y: y0 + (y1 - y0) * 0.15 },
      { x: first, y: low - s },
      { x: (left + right) / 2, y: low + s * 0.4 },
      { x: last, y: low - s },
      { x: last, y: y0 + (y1 - y0) * 0.1 },
    ];
    // not across a page of text (a list beside the window)
    if (crowding(path, avoid) > 1) return false;
    const via = path.map((p) => tie(win, p));
    lapAt = performance.now();
    go(to, { via, pace: 0.9 + rand() * 0.15 });
    return true;
  }

  function current(): Spot | null {
    const perch = bird.perch;
    return target && perch && perch.el === target.edge.el && Math.abs(perch.at - target.at) < 1e-3 ? target : null;
  }

  function wander() {
    timer = 0;
    // held still: the release picks the wandering up again
    if (!live || isHeld(bird)) return;
    if (document.hidden || still() || bird.flying || !bird.position) return schedule(2);
    const here = bird.position;
    const avoid = avoidNow();
    const cur = current();
    if (hops > 0 && cur) {
      hops--;
      if (shuffle(cur, avoid)) return;
    }
    hops = 0;
    const zi = activeZone();
    const spots = pool(zi, avoid);
    let kind = chooseKind(spots);
    if (kind === "shuffle" && cur) {
      hops = rand() < 0.45 ? 0 : rand() < 0.7 ? 1 : 2;
      if (shuffle(cur, avoid)) return note(kind);
      kind = "arc";
    }
    if (kind === "lap" && lap(here, zi, spots, avoid)) return note(kind);
    const lower = spots.filter((p) => p.y - here.y > bird.size * 1.2);
    const to = kind === "glide" && lower.length ? destination(here, lower, zi) : destination(here, spots, zi);
    if (!to) {
      // nowhere else in the open: a loop that comes back to this branch
      if (cur && spots.some((p) => p.edge.el === cur.edge.el)) {
        const back = spots.filter((p) => p.edge.el === cur.edge.el && p.at !== cur.at);
        const spot = back.length ? pick(back) : null;
        if (spot) {
          go(spot, { via: loopVia(here, spot, avoid), pace: 0.85 });
          return note("loop");
        }
      }
      if (cur && shuffle(cur, avoid)) return note("shuffle");
      return schedule(rest());
    }
    if (kind === "loop") {
      go(to, { via: loopVia(here, to, avoid), pace: 0.8 + rand() * 0.25 });
    } else if (kind === "glide" && to.y - here.y > bird.size * 1.2) {
      go(to, { via: glideVia(here, to, avoid), pace: 0.75 + rand() * 0.15 });
    } else {
      kind = "arc";
      // An arc bows upward. Where that crosses text it swoops under instead, or goes round by a
      // corner, whichever path is clearest.
      const d = Math.hypot(to.x - here.x, to.y - here.y);
      const mid = { x: (here.x + to.x) / 2, y: (here.y + to.y) / 2 };
      const apex = { x: mid.x, y: mid.y - 0.06 * d - 0.12 * bird.size };
      const bends = [
        null,
        { x: mid.x, y: mid.y + bird.size * (0.5 + rand() * 0.4) },
        { x: to.x, y: here.y - bird.size * 0.5 },
        { x: here.x, y: to.y - bird.size * 0.5 },
      ];
      const score = (b: Point | null) => crowding(along(b ? [here, b, to] : [here, apex, to]), avoid) + (b ? 0.5 : 0);
      const bend = bends.reduce((a, b) => (score(b) < score(a) ? b : a));
      go(to, { via: bend ? [tie(to.edge.el, bend)] : undefined, pace: 0.8 + rand() * 0.3 });
    }
    note(kind);
  }

  function note(kind: Kind) {
    recent.push(kind);
    if (recent.length > 4) recent.shift();
  }

  /**
   * The best perch for the reader's eye line as they scroll, skipping any the scroll is about to
   * carry out of the open part of the view (v: px/s the content is moving up).
   */
  function guideSpot(zi: number, avoid: Rect[], v: number): (Spot & Flight) | null {
    const eye = top() + (innerHeight - top()) * 0.38;
    const here = bird.position ?? { x: innerWidth / 2, y: eye };
    let best: Spot | null = null;
    let cost = Infinity;
    for (const p of pool(zi, avoid)) {
      const y = p.y - v * 0.8;
      if (y - bird.size < top() + 24 || y > innerHeight * 0.92) continue;
      const c = Math.abs(p.y - eye) + 0.3 * Math.abs(p.x - here.x) + Math.abs(p.zone - zi) * 300;
      if (c < cost) [best, cost] = [p, c];
    }
    if (best || v < 0) return best;
    // Nothing open in view (a tall window fills it): go ahead to the next zone's home and wait
    // there, down the margin beside the window where there is one rather than across it.
    const next = Math.min(zi + 1, zones.length - 1);
    const { home } = zoneAt(next);
    const p = pointOn(home, home.at);
    if (!p) return null;
    const win = zoneAt(zi).around?.()?.getBoundingClientRect();
    const s = bird.size;
    const side = win && (here.x < (win.left + win.right) / 2 ? win.left - s * 0.75 : win.right + s * 0.75);
    const via = side && side > s * 0.8 && side < innerWidth - s * 0.8 ? [{ x: side, y: innerHeight * 0.72 }] : undefined;
    return { ...p, zone: next, edge: home, at: home.at, via };
  }

  function check() {
    frame = 0;
    if (!live) return;
    const zi = activeZone();
    if (still()) {
      // No flights: the home perch nearest the eye line in the open part of the view, crossfaded;
      // with none in the open, the next one down, where it waits for the reader.
      const lo = top() + bird.size + 6;
      const hi = innerHeight - 8;
      const eye = lo + (hi - lo) * 0.35;
      let pickZone = -1;
      let nearest = Infinity;
      let ahead = -1;
      zones.forEach((zone, i) => {
        const y = pointOn(zone.home, zone.home.at)?.y;
        if (y === undefined) return;
        if (y >= lo && y <= hi && Math.abs(y - eye) < nearest) [pickZone, nearest] = [i, Math.abs(y - eye)];
        else if (y > hi && ahead < 0) ahead = i;
      });
      const next = pickZone >= 0 ? pickZone : ahead >= 0 ? ahead : zones.length - 1;
      if (next !== homeZone) {
        homeZone = next;
        const { home } = zoneAt(next);
        target = null;
        bird.perchOn(home.el, home).catch(() => undefined);
      }
      return;
    }
    homeZone = -1;
    if (!bird.position) {
      // not on the page yet (a reload part-way down): it appears on the best perch in view
      const spot = guideSpot(zi, avoidNow(), 0);
      if (spot) go(spot);
      return;
    }
    const s = bird.size;
    const p = target ? pointOn(target.edge, target.at) : null;
    // Where the scroll will have carried the perch by the time the bird is off it, so it leaves
    // before the nav can cover it rather than after.
    const v = performance.now() - lastT > 150 ? 0 : speed;
    const ahead = p ? p.y - v * LOOKAHEAD_S : 0;
    const settled = p && Math.min(p.y, ahead) - s >= top() + 24 && Math.max(p.y, ahead) <= innerHeight * 0.88;
    const urgent = p && ahead - s < top() + 8;
    const carried = Math.abs(scrollY - decidedY) > innerHeight * DRIFT;
    if (settled && target?.zone === zi && !carried) return;
    // At most every BEND_MS after a pick, and every CHECK_MS otherwise, but never a trailing wait.
    const now = performance.now();
    const wait = urgent ? 0 : Math.max(BEND_MS - (now - bentAt), CHECK_MS - (now - checkedAt));
    if (wait > 0) {
      clearTimeout(recheck);
      recheck = window.setTimeout(check, wait);
      return;
    }
    checkedAt = now;
    const spot = guideSpot(zi, avoidNow(), v);
    decidedY = scrollY;
    if (!spot || (target && spot.edge.el === target.edge.el && Math.abs(spot.at - target.at) < 0.02)) return;
    hops = 0;
    go(spot, { pace: 1.15, via: spot.via });
  }

  let speed = 0;
  let lastY = scrollY;
  let lastT = performance.now();
  const onScroll = () => {
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    // px/s the page content is moving up the view, smoothed over a few events; the first event of a
    // scroll, or a jump, says nothing about speed
    speed = dt > 100 ? 0 : speed + (((scrollY - lastY) / dt) * 1000 - speed) * Math.min(1, dt / 80);
    lastY = scrollY;
    lastT = now;
    frame ||= requestAnimationFrame(check);
  };
  const offLand = bird.on("land", () => {
    if (!live || bird.flying) return;
    schedule(hops > 0 ? 0.2 + rand() * 0.4 : rest());
  });
  const offRelease = onRelease(bird, () => {
    if (live && !bird.flying) schedule(0.6 + rand() * 0.6);
  });
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  // Start from wherever the bird already stands, if that is one of the zones' homes.
  const zi = zones.findIndex((zone) => zone.home.el === bird.perch?.el);
  const at = bird.perch?.at ?? 0;
  const start = zi >= 0 ? pointOn(zoneAt(zi).home, at) : null;
  if (start) target = { ...start, zone: zi, edge: zoneAt(zi).home, at };
  check();
  if (!bird.flying) schedule(rest());

  return () => {
    live = false;
    offLand();
    offRelease();
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    clearTimeout(recheck);
  };
}
