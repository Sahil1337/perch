let pixel: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS colour as rgb(), the form three.js and canvas 2D read. The app's tokens are oklch, often
 * behind a var(), so the browser resolves the value on a probe placed in `host` (where the var() is
 * in scope), then paints one pixel to read it back.
 */
export function toRgb(color: string, host: Element = document.body): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  probe.hidden = true;
  host.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  pixel ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", {
    willReadFrequently: true,
  });
  if (!pixel || !resolved) return color;
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = resolved;
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b] = pixel.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}
