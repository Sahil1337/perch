/**
 * The window is drawn at desktop size and scaled to the page, but the diagram measures its
 * viewport with `getBoundingClientRect` and reads pointer travel from `clientX`/`clientY`, both in
 * screen pixels. Under the scale both are off by it: Fit would fit a box the scale's size, and a
 * dragged card would trail the finger. This puts them back in the window's own pixels — the
 * viewport reports its layout size, and pointer coordinates over it are divided by the scale about
 * its corner — so every gesture runs through the app's own code and lands where the finger is.
 *
 * Only the viewport is patched: the cards, the window and everything a page anchors to still
 * report where they are on screen.
 */
export function nativeCoordinates(app: HTMLElement, viewportOf: () => HTMLElement | null): () => void {
  const rectOf = (element: Element): DOMRect => Element.prototype.getBoundingClientRect.call(element);
  let patched: HTMLElement | null = null;
  const patch = (): HTMLElement | null => {
    const viewport = viewportOf();
    if (viewport && viewport !== patched) {
      viewport.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement): DOMRect {
        const r = rectOf(this);
        return new DOMRect(r.x, r.y, this.offsetWidth, this.offsetHeight);
      };
      patched = viewport;
    }
    return viewport;
  };
  patch();

  const remap = (event: PointerEvent): void => {
    const viewport = patch();
    const target = event.target instanceof Node ? event.target : null;
    if (!viewport || !target || !viewport.contains(target)) return;
    const r = rectOf(viewport);
    const scale = viewport.offsetWidth > 0 ? r.width / viewport.offsetWidth : 1;
    if (!(scale > 0) || Math.abs(scale - 1) < 0.001) return;
    const x = r.left + (event.clientX - r.left) / scale;
    const y = r.top + (event.clientY - r.top) / scale;
    Object.defineProperty(event, "clientX", { configurable: true, value: x });
    Object.defineProperty(event, "clientY", { configurable: true, value: y });
  };
  const types = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
  for (const type of types) app.addEventListener(type, remap, true);
  return () => {
    for (const type of types) app.removeEventListener(type, remap, true);
  };
}
