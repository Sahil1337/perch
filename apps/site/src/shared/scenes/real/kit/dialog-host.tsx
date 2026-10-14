// The heavy half of what the real Relationship View and Query Walk scenes share. Both surfaces are
// the app's dialogs with the dialog taken away: `SchemaDiagram` and `QueryWalk` are what
// `SchemaDiagramDialog` and `QueryWalkDialog` put in their popup, and they are mounted here inside
// the scene's window instead, over the same backdrop and at the same inset. The dialogs themselves
// cannot be used on a page — they are modal, so opening one would lock the page's scroll.

import { Dialog, DialogPortal } from "@perch/ui";
import * as React from "react";

/**
 * The context the two surfaces need from a dialog — their title, description and close button are
 * Base UI dialog parts — without a dialog. Non-modal and never closed by Base UI itself: an outside
 * press or Escape is ignored, and only the surface's own close button reaches `onClose`.
 *
 * Every portal inside resolves to this one's node, which is in the window: the toolbar's tooltips
 * open there, in the app's theme and at the window's scale, rather than on the page's body.
 */
export function DialogHost({
  container,
  onClose,
  children,
}: {
  container: HTMLElement;
  onClose?: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Dialog
      modal={false}
      onOpenChange={(open, details) => {
        if (!open && details.reason === "close-press") onClose?.();
      }}
      open
    >
      <DialogPortal className="absolute inset-0" container={container}>
        {children}
      </DialogPortal>
    </Dialog>
  );
}

/** What the app's dialog popup sits on: the backdrop over the app, and the popup inset 12px. */
export function DialogFrame({
  closing = false,
  children,
}: {
  closing?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <div aria-hidden className="absolute inset-0 bg-black/32" />
      <div
        className={
          closing
            ? "absolute inset-3 flex min-h-0 min-w-0 scale-98 flex-col opacity-0 transition-all duration-200 ease-in-out"
            : "absolute inset-3 flex min-h-0 min-w-0 flex-col transition-all duration-200 ease-in-out"
        }
      >
        {children}
      </div>
    </>
  );
}

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
