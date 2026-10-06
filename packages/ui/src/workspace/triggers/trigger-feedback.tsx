// How a change the drawer ran reports back: a quiet line when it landed, and Postgres's own words
// when it didn't. The failure keeps `detail` and `hint`, because those are the fields that usually
// say what to do about it.

import type { QueryError } from "@perch/protocol";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { motion } from "motion/react";
import type * as React from "react";
import { useFade } from "../../lib/motion";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { BUSY_MESSAGE, scriptErrorMessage } from "./trigger-sql";

export function ChangeFailed({ error }: { error: QueryError }): React.ReactElement {
  const message = scriptErrorMessage(error);
  // A lock or statement timeout says only that it timed out; the busy line says what that means.
  const busy = message === BUSY_MESSAGE;
  return (
    <Alert variant="error">
      <CircleAlertIcon />
      <AlertTitle className="break-words">{message}</AlertTitle>
      {!busy && (error.detail || error.hint) && (
        <AlertDescription className="break-words">
          {error.detail && <p>{error.detail}</p>}
          {error.hint && <p>Hint: {error.hint}</p>}
        </AlertDescription>
      )}
    </Alert>
  );
}

/** "Created. The SQL is in History." Where the change can be read back, and run again. */
export function ChangeFlash({ text }: { text: string }): React.ReactElement {
  const fade = useFade();
  return (
    <motion.span
      animate={{ opacity: 1 }}
      className="inline-flex items-center gap-1 text-success-foreground text-xs"
      initial={{ opacity: 0 }}
      role="status"
      transition={fade}
    >
      <CheckIcon className="size-3.5 shrink-0" />
      {text}. The SQL is in History.
    </motion.span>
  );
}
