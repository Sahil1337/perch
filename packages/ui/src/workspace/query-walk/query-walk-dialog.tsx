"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import * as React from "react";
import { cn } from "../../lib/utils";
import { DialogBackdrop, DialogPortal } from "../../ui/dialog";
import { QueryWalk } from "./query-walk";
import { QUERY_WALK_EVENT, type QueryWalkEventDetail } from "./query-walk-event";

/**
 * The query walk, mounted once in the shell. Opens on `requestQueryWalk(sql)`, over the whole
 * window: the stage wants every pixel a wide join can take.
 */
export function QueryWalkDialog(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [sql, setSql] = React.useState("");

  React.useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<QueryWalkEventDetail>).detail;
      if (!detail?.sql.trim()) return;
      setSql(detail.sql);
      setOpen(true);
    };
    window.addEventListener(QUERY_WALK_EVENT, listener);
    return () => window.removeEventListener(QUERY_WALK_EVENT, listener);
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
          {open && <QueryWalk key={sql} sql={sql} />}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
