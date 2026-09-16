"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import * as React from "react";
import { cn } from "../../lib/utils";
import { DialogBackdrop, DialogPortal } from "../../ui/dialog";
import { SchemaDiagram } from "./schema-diagram";
import { SCHEMA_DIAGRAM_EVENT, type SchemaDiagramEventDetail } from "./schema-diagram-event";

/**
 * The relationship view, mounted once in the shell. Opens on `requestSchemaDiagram()`, over the
 * whole window: a diagram is the one thing in the app that wants every pixel it can get.
 */
export function SchemaDiagramDialog(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [focus, setFocus] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<SchemaDiagramEventDetail>).detail;
      setFocus(detail?.focus);
      setOpen(true);
    };
    window.addEventListener(SCHEMA_DIAGRAM_EVENT, listener);
    return () => window.removeEventListener(SCHEMA_DIAGRAM_EVENT, listener);
  }, []);

  return (
    <DialogPrimitive.Root onOpenChange={setOpen} open={open}>
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
          {open && <SchemaDiagram focus={focus} />}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
