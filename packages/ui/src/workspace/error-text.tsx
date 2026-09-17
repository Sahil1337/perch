"use client";

// The one line a form or a dialog shows when a write came back refused. Small, red, announced —
// and identical everywhere, because a failure that looks different in each dialog reads as a
// different kind of failure.
//
// Not `FieldError` from `ui/field.tsx`: that one is Base UI's, and only renders for a control's own
// validity inside a `Field`. These errors come back from the server and belong to the whole form.

import type * as React from "react";
import { cn } from "../lib/utils";

export function ErrorText({
  children,
  className,
}: {
  /** Null, undefined or false renders nothing, so a call site can pass its error state through. */
  children: React.ReactNode;
  className?: string;
}): React.ReactElement | null {
  if (children === null || children === undefined || children === false) return null;
  return (
    <p className={cn("text-destructive-foreground text-xs", className)} role="alert">
      {children}
    </p>
  );
}
