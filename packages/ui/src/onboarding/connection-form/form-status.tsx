// What the round trip came back with. Saving and testing are one action, so there is one place
// that reports: a latency and a version when the server answered, the failure otherwise.

import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useFade, useSpring } from "../../lib/motion";
import type { ConnectionTest } from "../../workspace/types";

export type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "testing" }
  | { kind: "ok"; test: ConnectionTest }
  | { kind: "error"; message: string };

/** The success chip, beside the submit button. */
export function TestOk({ phase }: { phase: Phase }): React.ReactElement {
  const fade = useFade();
  const spring = useSpring();

  return (
    <AnimatePresence initial={false} mode="wait">
      {phase.kind === "ok" && (
        <motion.p
          animate={{ opacity: 1 }}
          className="ml-auto flex min-w-0 items-center gap-1.5 text-success-foreground text-xs"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          key="ok"
          transition={fade}
        >
          <motion.span
            animate={{ scale: 1 }}
            className="flex"
            initial={{ scale: 0.4 }}
            transition={spring}
          >
            <CheckIcon className="size-3.5" />
          </motion.span>
          <span className="truncate tabular-nums">
            {Math.round(phase.test.latencyMs)} ms · {phase.test.serverVersion}
          </span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** The failure, under the form: it sits next to the fields that caused it, not in a toast. */
export function TestError({ phase }: { phase: Phase }): React.ReactElement {
  const spring = useSpring();

  return (
    <AnimatePresence initial={false}>
      {phase.kind === "error" && (
        <motion.p
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden text-destructive-foreground text-xs"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          role="alert"
          transition={spring}
        >
          {phase.message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
