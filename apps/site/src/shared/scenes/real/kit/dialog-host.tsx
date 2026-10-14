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
