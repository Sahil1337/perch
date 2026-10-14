import { BufferGeometry, Float32BufferAttribute } from "three";

type Vec = [number, number, number];

// A rounded rectangle as a ring of points, two segments to a corner: with flat shading each segment
// is its own facet, which is what makes the cap read as cut porcelain rather than moulded plastic.
function ring(a: number, b: number, r: number, y: number, dz: number, n = 2): Vec[] {
  const out: Vec[] = [];
  const corners: [number, number, number][] = [
    [a - r, b - r, 0],
    [-(a - r), b - r, 0.5],
    [-(a - r), -(b - r), 1],
    [a - r, -(b - r), 1.5],
  ];
  for (const [cx, cz, start] of corners) {
    for (let i = 0; i <= n; i++) {
      const t = (start + (i / n) * 0.5) * Math.PI;
      out.push([cx + r * Math.cos(t), y, cz + r * Math.sin(t) + dz]);
    }
  }
  return out;
}

/** A keycap: tapered walls, a bevel, a shallow dish on top. Group 0 is the body, group 1 the top. */
export function keycap(w: number, d: number, h: number): { geometry: BufferGeometry; face: { w: number; d: number } } {
  const a0 = w / 2 - 0.06;
  const b0 = d / 2 - 0.06;
  const lean = -0.035;
  const L0 = ring(a0, b0, 0.11, 0, 0);
  const L1 = ring(a0 - 0.075, b0 - 0.075, 0.1, h * 0.82, lean * 0.82);
  const a2 = a0 - 0.15;
  const b2 = b0 - 0.15;
  const L2 = ring(a2, b2, 0.08, h, lean);
  const dish = 0.025;
  const L3 = ring(a2 * 0.62, b2 * 0.62, 0.05, h - dish * 0.75, lean);
  const centre: Vec = [0, h - dish, lean];

  const body: number[] = [];
  const top: number[] = [];
  const uv: number[] = [];
  const push = (target: number[], ...ps: Vec[]) => {
    for (const p of ps) target.push(p[0], p[1], p[2]);
  };
  const band = (A: Vec[], B: Vec[], target: number[]) => {
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      push(target, A[i]!, A[j]!, B[j]!, A[i]!, B[j]!, B[i]!);
    }
  };
  band(L0, L1, body);
  band(L1, L2, body);
  const floor: Vec = [0, 0, 0];
  for (let i = 0; i < L0.length; i++) push(body, floor, L0[(i + 1) % L0.length]!, L0[i]!);
  band(L2, L3, top);
  for (let i = 0; i < L3.length; i++) push(top, centre, L3[i]!, L3[(i + 1) % L3.length]!);

  for (let i = 0; i < body.length / 3; i++) uv.push(0, 0);
  for (let i = 0; i < top.length; i += 3) {
    uv.push((top[i]! + a2) / (2 * a2), (b2 + lean - top[i + 2]!) / (2 * b2));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([...body, ...top], 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.addGroup(0, body.length / 3, 0);
  geometry.addGroup(body.length / 3, top.length / 3, 1);
  return { geometry, face: { w: a2 * 2, d: b2 * 2 } };
}

