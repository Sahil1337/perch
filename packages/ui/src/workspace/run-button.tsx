// Start the run, and stop it.
//
// One control, two jobs. Against a real server the thing you most want after pressing Run is the
// ability to take it back, and a cancel that lives somewhere else is a cancel nobody finds in time.
// `Run` becomes `Cancel` in place, so the pointer is already over the control that stops it.
//
// The shortcut is set, not chipped: plain dimmed text, which is all a hint needs to be when it
// already sits inside the thing it hints at. A `Kbd` here is a bordered block on a saturated one,
// two surfaces fighting in one control; a split control says the same thing at twice the width.
//
// It goes while the run does: `⌘↵` starts a query and does not cancel one, so leaving it under a
// Cancel would be advertising a key that does something else.
//
// Cancelling needs the run's id (`POST /api/runs/:id/cancel`), which is why this reads `activeRun`
// rather than tracking a local "is running" boolean.

import { PlayIcon, SquareIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useFade, useSpring } from "../lib/motion";
import { Button } from "../ui/button";
import { useWorkspace } from "./context";

export function RunButton({ className }: { className?: string }): React.ReactElement {
  const { activeRun, run, cancelRun } = useWorkspace();
  const spring = useSpring();
  const fade = useFade();
  const running = activeRun?.status === "running";

  return (
    <Button
      className={className}
      onClick={() => {
        if (running && activeRun) void cancelRun(activeRun.id);
        else void run();
      }}
      // `layout` carries the width between "Run ⌘↵" and "Cancel" instead of letting it snap.
      render={<motion.button layout transition={spring} />}
      size="sm"
      variant={running ? "destructive" : "default"}
    >
      {/* `popLayout`, not `wait`: waiting empties the button for the length of both fades, and an
          empty button collapses to its padding and springs back. */}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ opacity: 1 }}
          className="inline-flex items-center gap-1.5"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          key={running ? "running" : "idle"}
          transition={fade}
        >
          {running ? (
            <>
              <SquareIcon />
              Cancel
            </>
          ) : (
            <>
              <PlayIcon />
              Run
              <span aria-hidden className="text-primary-foreground/56">
                ⌘↵
              </span>
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}
