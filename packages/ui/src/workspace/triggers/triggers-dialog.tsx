import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import * as React from "react";
import { cn } from "../../lib/utils";
import { DialogBackdrop, DialogPortal } from "../../ui/dialog";
import { Triggers, type TriggersHandle } from "./triggers";
import { noTriggersRequest, subscribeTriggers, triggersRequest } from "./triggers-event";

/**
 * The Triggers view, mounted once in the shell. Opens on `requestTriggers()`, over the whole
 * window like the relationship view: five columns of triggers want the width.
 */
export function TriggersDialog(): React.ReactElement {
  const request = React.useSyncExternalStore(subscribeTriggers, triggersRequest, noTriggersRequest);
  // Closing is this component's own state; opening is the store's. See the query walk's dialog.
  const [closed, setClosed] = React.useState<number | null>(null);
  const open = request !== null && closed !== request.nth;
  const view = React.useRef<TriggersHandle>(null);

  return (
    <DialogPrimitive.Root
      onOpenChange={(next, details) => {
        // Only a press on the backdrop is a press outside the view. CodeMirror redraws the line
        // under the pointer between mousedown and mouseup, and the browser then sends the click to
        // the document root, which would read as outside and close the view from inside the
        // function body's editor.
        if (!next && details.reason === "outside-press") {
          const target = details.event?.target;
          if (!(target instanceof Element && target.closest("[data-slot=dialog-backdrop]"))) {
            details.cancel();
            return;
          }
        }
        // Escape closes what is open inside the view first, the drawer, and the view only after.
        // Any other close waits while a form with changes asks whether to throw them away.
        if (!next && view.current) {
          const kept =
            details.reason === "escape-key" ? view.current.dismiss() : !view.current.release();
          if (kept) {
            details.cancel();
            return;
          }
        }
        setClosed(next ? null : (request?.nth ?? null));
      }}
      open={open}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-3 z-50 flex min-h-0 min-w-0 origin-center flex-col outline-none",
            "transition-all duration-200 ease-in-out",
            "data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
          )}
          data-slot="dialog-popup"
        >
          {/* Keyed by the request, so every open starts fresh and plays once on its own. */}
          {open && (
            <Triggers
              focus={request.focus}
              key={request.nth}
              onClose={() => setClosed(request.nth)}
              ref={view}
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
