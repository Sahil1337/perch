// Closing a tab that holds a transaction rolls it back, so the close asks first. Two presses, the
// way removing a saved connection asks: the close control turns into "Roll back and close", and
// that is the second press. It is a different target with a different colour and label, so a
// double click on the × cannot confirm by accident.

import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { useWorkspace } from "./context";

export type CloseGuard = {
  /** Showing "Roll back and close" in place of the close control. */
  readonly armed: boolean;
  /** The close control's press: closes, or asks first when the tab holds a transaction. */
  request(): void;
  confirm(): void;
  cancel(): void;
};

export function useCloseGuard(bufferId: string | null, close: () => void): CloseGuard {
  const { transactionFor } = useWorkspace();
  const [asked, setAsked] = React.useState(false);
  const holds = bufferId !== null && transactionFor(bufferId) !== null;

  return {
    // Derived, so a transaction that ends while the question is up takes the question with it.
    armed: asked && holds,
    request: () => (holds ? setAsked(true) : close()),
    confirm: () => {
      setAsked(false);
      close();
    },
    cancel: () => setAsked(false),
  };
}

/** The second press. Focus lands on it, and leaving it (or Escape) takes the question back. */
export function RollBackAndClose({
  guard,
  className,
}: {
  guard: CloseGuard;
  className?: string;
}): React.ReactElement {
  return (
    <Button
      autoFocus
      className={cn("shrink-0", className)}
      onBlur={guard.cancel}
      onClick={guard.confirm}
      onKeyDown={(event) => {
        if (event.key === "Escape") guard.cancel();
      }}
      size="xs"
      title="Closing this tab rolls back its open transaction"
      variant="destructive"
    >
      Roll back and close
    </Button>
  );
}
