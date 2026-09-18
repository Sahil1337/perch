// Settings with no Save button.
//
// A preferences dialog whose controls do not take effect until you press something is a dialog
// that lies to you twice: once while you look at a value that is not in force, and once when you
// close it and lose the change. So every control here writes on interaction, and the only thing
// left to design is the receipt — quiet enough to ignore, present enough that a failed write is
// never silent.
//
// Errors are sticky and success is not, which is the asymmetry that matters: a tick you missed
// cost you nothing, an error you missed cost you the setting.

import type { Settings } from "@perch/protocol";
import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { messageOf } from "../lib/errors";
import { useFade } from "../lib/motion";
import { cn } from "../lib/utils";
import { Spinner } from "../ui/spinner";
import { useWorkspace } from "../workspace/context";

export type WriteState = "idle" | "saving" | "saved" | "error";

/** How long the tick stays up before fading. Long enough to notice, short enough to forget. */
const SAVED_MS = 1600;

export type SettingsWriter = {
  readonly state: WriteState;
  readonly error: string | null;
  write: (patch: Partial<Settings>) => void;
};

export function useSettingsWriter(): SettingsWriter {
  const { updateSettings } = useWorkspace();
  const [state, setState] = React.useState<WriteState>("idle");
  const [error, setError] = React.useState<string | null>(null);

  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Only the newest write may report — two switches flipped in quick succession must not have the
  // first one's tick land after the second one's error.
  const seq = React.useRef(0);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const write = React.useCallback(
    (patch: Partial<Settings>) => {
      const mine = ++seq.current;
      clearTimeout(timer.current);
      setState("saving");
      setError(null);
      void updateSettings(patch).then(
        () => {
          if (seq.current !== mine) return;
          setState("saved");
          timer.current = setTimeout(() => setState("idle"), SAVED_MS);
        },
        (cause: unknown) => {
          if (seq.current !== mine) return;
          setError(messageOf(cause));
          setState("error");
        },
      );
    },
    [updateSettings],
  );

  return { state, error, write };
}

/** The receipt. Occupies its slot at all times so the header does not reflow as it changes. */
export function SavedTick({
  writer,
  className,
}: {
  writer: SettingsWriter;
  className?: string;
}): React.ReactElement {
  const fade = useFade();

  return (
    <span className={cn("flex min-h-4 items-center", className)}>
      <AnimatePresence initial={false} mode="wait">
        {writer.state !== "idle" && (
          <motion.span
            animate={{ opacity: 1 }}
            className={cn(
              "flex items-center gap-1 text-xs",
              writer.state === "error" ? "text-destructive-foreground" : "text-muted-foreground",
            )}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={writer.state}
            role={writer.state === "error" ? "alert" : undefined}
            transition={fade}
          >
            {writer.state === "saving" && <Spinner className="size-3" />}
            {writer.state === "saved" && <CheckIcon className="size-3" />}
            {writer.state === "saving" && "Saving…"}
            {writer.state === "saved" && "Saved"}
            {writer.state === "error" && (writer.error ?? "Could not save")}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
