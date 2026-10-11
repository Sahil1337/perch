import { CanvasTexture, SRGBColorSpace } from "three";
import { type KeyId, LEGEND } from "../keymap";
import type { SculptureColors } from "./colors";

// Texture px per key unit.
const PX = 200;

// The legend is fired into the glaze: thin, warm, the one seam of colour on the white.
function drawLegend(id: KeyId, face: { w: number; d: number }, colors: SculptureColors): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(face.w * PX);
  canvas.height = Math.round(face.d * PX);
  const g = canvas.getContext("2d");
  if (!g) return canvas;
  g.fillStyle = colors.porcelain;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = colors.glaze;
  g.strokeStyle = colors.glaze;
  g.lineCap = "round";
  g.lineJoin = "round";
  const text = LEGEND[id];
  if (text.length === 1) {
    g.font = `300 ${Math.round(PX * 0.28)}px "Geist Mono Variable", ui-monospace, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, canvas.width / 2, canvas.height / 2 + PX * 0.02);
  } else if (text) {
    const size = Math.round(PX * 0.13);
    g.font = `400 ${size}px "Geist Mono Variable", ui-monospace, monospace`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    const left = PX * 0.12;
    const base = canvas.height - PX * 0.14;
    g.fillText(text, left, base);
    g.lineWidth = PX * 0.01;
    const x = left + g.measureText(text).width + PX * 0.1;
    const y = base - size * 0.32;
    g.beginPath();
    if (id === "return") {
      // ↵, drawn: the font's own arrow would come from a fallback face.
      g.moveTo(x + PX * 0.2, y - PX * 0.11);
      g.lineTo(x + PX * 0.2, y);
      g.lineTo(x, y);
      g.moveTo(x + PX * 0.05, y - PX * 0.045);
      g.lineTo(x, y);
      g.lineTo(x + PX * 0.05, y + PX * 0.045);
    } else {
      g.moveTo(x, y);
      g.lineTo(x + PX * 0.18, y);
      g.moveTo(x + PX * 0.13, y - PX * 0.045);
      g.lineTo(x + PX * 0.18, y);
      g.lineTo(x + PX * 0.13, y + PX * 0.045);
      g.moveTo(x + PX * 0.2, y - PX * 0.06);
      g.lineTo(x + PX * 0.2, y + PX * 0.06);
    }
    g.stroke();
  }
  return canvas;
}

/** A key's top: porcelain with its legend, for a face `face` key units across. */
export function legendTexture(id: KeyId, face: { w: number; d: number }, colors: SculptureColors): CanvasTexture {
  const texture = new CanvasTexture(drawLegend(id, face, colors));
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Draws a legend again, once its font has arrived. */
export function redrawLegend(texture: CanvasTexture, id: KeyId, colors: SculptureColors) {
  const canvas = texture.image as HTMLCanvasElement;
  const fresh = drawLegend(id, { w: canvas.width / PX, d: canvas.height / PX }, colors);
  canvas.getContext("2d")?.drawImage(fresh, 0, 0);
  texture.needsUpdate = true;
}

// A soft rounded-rectangle shadow, drawn once and shared: the dark that gathers where a key meets
// the floor, which the light's own shadow is too crisp to give.
export function contactTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext("2d");
  if (g) {
    // an alpha map reads the green channel: white is solid
    g.shadowColor = "white";
    g.shadowBlur = 18;
    g.shadowOffsetX = 400;
    g.fillStyle = "white";
    g.beginPath();
    g.roundRect(28 - 400, 28, 72, 72, 14);
    g.fill();
  }
  return new CanvasTexture(canvas);
}

