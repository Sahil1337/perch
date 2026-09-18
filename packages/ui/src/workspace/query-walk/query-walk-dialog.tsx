import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import * as React from "react";
import { cn } from "../../lib/utils";
import { DialogBackdrop, DialogPortal } from "../../ui/dialog";
import { QueryWalk } from "./query-walk";
import {
  noQueryWalkRequest,
  queryWalkRequest,
  subscribeQueryWalk,
} from "./query-walk-event";

/**
 * The query walk, mounted once in the shell. Opens on `requestQueryWalk(sql)`, over the whole
 * window: the stage wants every pixel a wide join can take.
 */
export function QueryWalkDialog(): React.ReactElement {
  const request = React.useSyncExternalStore(
    subscribeQueryWalk,
    queryWalkRequest,
    noQueryWalkRequest,
  );
  // Closing is this component's own state; opening is the store's. They are combined rather than
  // merged, so dismissing the dialog does not have to write back to a store the whole app shares.
  const [closed, setClosed] = React.useState<number | null>(null);
  const open = request !== null && closed !== request.nth;
  const sql = request?.sql ?? "";

  return (
    <DialogPrimitive.Root
      onOpenChange={(next) => setClosed(next ? null : (request?.nth ?? null))}
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
          {open && <QueryWalk key={sql} sql={sql} />}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
