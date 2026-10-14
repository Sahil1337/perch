// The cell bird's poses, baked once into coverage fields the grid samples. A pose is drawn with
// canvas paths in the bird's own units (1 = tail to beak, facing right, y down, origin mid-body), the
// red channel carrying how light each part is, so the fields hold both the silhouette and its shading.
// It is the porcelain bird's build, a plump songbird, so the cells can turn into it.

export type Pose = {
  /** Wing elevation, -1 (fully down) to 1 (fully up). */
  wing: number;
  /** 1 extended, 0 half folded, as on an upstroke. */
  spread: number;
  /** Body pitch in radians; negative lifts the head. */
  pitch: number;
  /** 0 streamlined, 1 fanned and lowered, as for landing. */
  tail: number;
  /** 0 tucked, 1 reaching down for the perch. */
  legs: number;
};

export type Field = { alpha: Uint8Array; shade: Uint8Array };

/** The box every field covers, in bird units. Wide enough for a raised wing and a lowered one. */
export const BOX = { left: -0.7, top: -0.78, width: 1.4, height: 1.4 };
const RES = 110;
export const FW = Math.round(BOX.width * RES);
export const FH = Math.round(BOX.height * RES);

/**
 * The perched pose's feet, in bird units from the origin: the point that lands on the headline, the
 * same point the porcelain bird stands on.
 */
export const PERCHED_FEET = { x: 0, y: 0.42 };

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const ink = (shade: number) => `rgb(${Math.round(shade * 255)},0,0)`;

function wingPath(ctx: Ctx, rootFront: number, rootBack: number, rootY: number, tipX: number, tipY: number) {
  const up = tipY < rootY ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(rootFront, rootY);
  // The leading edge bows out; the trailing edge is notched where the primaries part.
  ctx.quadraticCurveTo(rootFront + (tipX - rootFront) * 0.25 + 0.04, rootY + (tipY - rootY) * 0.62, tipX, tipY);
  const notches = 4;
  for (let i = 1; i <= notches; i++) {
    const k = i / notches;
    const x = tipX + (rootBack - tipX) * k;
    const y = tipY + (rootY + 0.02 * up - tipY) * k;
    if (i < notches) ctx.lineTo(x - 0.035 * (1 - k), y + 0.03 * up * (1 - k));
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawWing(ctx: Ctx, pose: Pose, far: boolean) {
  const lift = Math.sin(pose.wing * 1.3);
  const reach = 0.24 + 0.36 * pose.spread;
  const rootY = far ? -0.11 : -0.07;
  const front = far ? 0.17 : 0.13;
  const back = far ? -0.1 : -0.15;
  // Raised, the tip sweeps back; lowered, it reaches forward, as on a downstroke.
  const tipX = (far ? 0.03 : -0.04) - 0.1 * Math.max(0, lift) + 0.08 * Math.max(0, -lift);
  const tipY = rootY - reach * lift + (1 - Math.abs(lift)) * 0.1;
  ctx.fillStyle = ink(far ? 0.52 : 0.88);
  wingPath(ctx, front, back, rootY, tipX, tipY);
  ctx.fill();
  if (far) return;
  // Covert lines: darker strokes that come through as dimmer glyphs across the wing.
  ctx.strokeStyle = ink(0.62);
  ctx.lineWidth = 0.016;
  for (const k of [0.4, 0.68]) {
    ctx.beginPath();
    ctx.moveTo(front + (back - front) * k, rootY);
    ctx.lineTo(tipX + (back - tipX) * k * 0.45, tipY + (rootY - tipY) * k * 0.45);
    ctx.stroke();
  }
}

function drawFlyingBody(ctx: Ctx, pose: Pose) {
  const body = ctx.createLinearGradient(0, -0.18, 0, 0.16);
  body.addColorStop(0, ink(1));
  body.addColorStop(1, ink(0.72));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0.02, 0, 0.29, 0.155, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.25, -0.07, 0.13, 0, Math.PI * 2);
  ctx.fill();

  const drop = pose.tail * 0.12;
  const fan = 0.05 + pose.tail * 0.05;
  ctx.fillStyle = ink(0.7);
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.05);
  ctx.lineTo(-0.5, -0.03 + drop - fan);
  ctx.lineTo(-0.52, 0.02 + drop + fan * 0.6);
  ctx.lineTo(-0.2, 0.07);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ink(0.6);
  ctx.beginPath();
  ctx.moveTo(0.36, -0.1);
  ctx.lineTo(0.47, -0.065);
  ctx.lineTo(0.36, -0.035);
  ctx.closePath();
  ctx.fill();

  if (pose.legs > 0) {
    ctx.strokeStyle = ink(0.55);
    ctx.lineWidth = 0.035;
    ctx.lineCap = "round";
    for (const dx of [-0.04, 0.06]) {
      ctx.beginPath();
      ctx.moveTo(dx, 0.1);
      ctx.lineTo(dx + 0.04 * pose.legs, 0.1 + 0.2 * pose.legs);
      ctx.stroke();
    }
  }
}

function drawFlying(ctx: Ctx, pose: Pose) {
  ctx.save();
  ctx.rotate(pose.pitch);
  drawWing(ctx, pose, true);
  drawFlyingBody(ctx, pose);
  drawWing(ctx, pose, false);
  ctx.restore();
}

/** Standing, as the porcelain bird stands: upright and round, tail down behind, feet on the line. */
function drawPerched(ctx: Ctx) {
  ctx.strokeStyle = ink(0.5);
  ctx.lineWidth = 0.035;
  ctx.lineCap = "round";
  for (const x of [0.09, -0.1]) {
    ctx.beginPath();
    ctx.moveTo(x, 0.18);
    ctx.lineTo(x, PERCHED_FEET.y);
    ctx.stroke();
  }
  ctx.fillStyle = ink(0.7);
  ctx.beginPath();
  ctx.moveTo(-0.13, -0.04);
  ctx.lineTo(-0.5, 0.16);
  ctx.lineTo(-0.47, 0.23);
  ctx.lineTo(-0.09, 0.09);
  ctx.closePath();
  ctx.fill();

  const body = ctx.createLinearGradient(0, -0.45, 0, 0.27);
  body.addColorStop(0, ink(1));
  body.addColorStop(1, ink(0.74));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0.08, -0.02, 0.25, 0.29, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.17, -0.3, 0.17, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = ink(0.82);
  ctx.beginPath();
  ctx.ellipse(-0.04, 0.0, 0.21, 0.12, -0.45, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = ink(0.6);
  ctx.beginPath();
  ctx.moveTo(0.31, -0.34);
  ctx.lineTo(0.45, -0.3);
  ctx.lineTo(0.31, -0.26);
  ctx.closePath();
  ctx.fill();
}

function bake(draw: (ctx: Ctx) => void, surface: OffscreenCanvas | HTMLCanvasElement): Field {
  const ctx = surface.getContext("2d", { willReadFrequently: true }) as Ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, FW, FH);
  ctx.setTransform(RES, 0, 0, RES, -BOX.left * RES, -BOX.top * RES);
  draw(ctx);
  const data = ctx.getImageData(0, 0, FW, FH).data;
  const alpha = new Uint8Array(FW * FH);
  const shade = new Uint8Array(FW * FH);
  for (let i = 0; i < FW * FH; i++) {
    alpha[i] = data[i * 4 + 3] ?? 0;
    shade[i] = data[i * 4] ?? 0;
  }
  return { alpha, shade };
}

export type Frames = {
  /** One wing cycle, starting wings up. */
  flap: Field[];
  /** Wings held up in a shallow V, the way a small bird glides between beats. */
  glide: Field;
  /** Wings high, tail fanned, legs reaching: the moment before touching down. */
  flare: Field;
  perch: Field;
};

export const FLAP_FRAMES = 12;

export function bakeFrames(): Frames {
  const surface =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(FW, FH)
      : Object.assign(document.createElement("canvas"), { width: FW, height: FH });
  const flying = (pose: Pose) => bake((ctx) => drawFlying(ctx, pose), surface);
  const flap: Field[] = [];
  for (let i = 0; i < FLAP_FRAMES; i++) {
    const phase = i / FLAP_FRAMES;
    const wing = Math.cos(phase * Math.PI * 2);
    // The downstroke is made with the wing fully spread; the upstroke with it half folded.
    const spread = phase < 0.5 ? 1 : 0.55 + 0.45 * Math.abs(wing);
    flap.push(flying({ wing, spread, pitch: -0.05 * wing, tail: 0, legs: 0 }));
  }
  return {
    flap,
    glide: flying({ wing: 0.42, spread: 1, pitch: 0.03, tail: 0, legs: 0 }),
    flare: flying({ wing: 0.95, spread: 0.9, pitch: -0.5, tail: 1, legs: 0.8 }),
    perch: bake(drawPerched, surface),
  };
}

/** Bilinear coverage and nearest shade at a point in bird units; zero outside the box. */
export function sample(field: Field, u: number, v: number, out: { a: number; s: number }) {
  const fx = (u - BOX.left) * RES - 0.5;
  const fy = (v - BOX.top) * RES - 0.5;
  if (fx < 0 || fy < 0 || fx >= FW - 1 || fy >= FH - 1) {
    out.a = 0;
    out.s = 0;
    return;
  }
  const x0 = fx | 0;
  const y0 = fy | 0;
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * FW + x0;
  const a = field.alpha;
  const a00 = a[i] ?? 0;
  const a10 = a[i + 1] ?? 0;
  const a01 = a[i + FW] ?? 0;
  const a11 = a[i + FW + 1] ?? 0;
  const top = a00 + (a10 - a00) * tx;
  const bottom = a01 + (a11 - a01) * tx;
  out.a = (top + (bottom - top) * ty) / 255;
  out.s = (field.shade[(ty < 0.5 ? i : i + FW) + (tx < 0.5 ? 0 : 1)] ?? 0) / 255;
}

/** A box in bird units. */
export type Extent = { left: number; top: number; right: number; bottom: number };

/** The box the solid parts of these fields fill together, in bird units. */
export function extentOf(fields: readonly Field[]): Extent {
  let x0 = FW;
  let y0 = FH;
  let x1 = 0;
  let y1 = 0;
  for (const field of fields) {
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        if ((field.alpha[y * FW + x] ?? 0) < 128) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { left: BOX.left + x0 / RES, top: BOX.top + y0 / RES, right: BOX.left + (x1 + 1) / RES, bottom: BOX.top + (y1 + 1) / RES };
}
