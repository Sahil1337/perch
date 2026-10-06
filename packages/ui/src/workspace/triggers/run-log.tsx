import type { TriggerOperation } from "@perch/protocol";
import { motion, type Transition } from "motion/react";
import * as React from "react";
import { cn } from "../../lib/utils";
import type { Step } from "./lane-playback";

const Name = ({ children }: { children: React.ReactNode }): React.ReactElement => (
  <span className="font-mono text-foreground">{children}</span>
);

function lineFor(step: Step, event: TriggerOperation): React.ReactNode {
  const onRow = step.row === null ? "" : ` · row ${step.row}`;
  const trigger = step.trigger;
  switch (step.kind) {
    case "start":
      return "Statement starts";
    case "row":
      return step.stage === "after-row"
        ? `After-row triggers for row ${step.row}`
        : `Row ${step.row}`;
    case "fire":
      return (
        <>
          <Name>{trigger?.name}</Name> runs <Name>{trigger?.function.name}()</Name>
          {onRow}
          {trigger && trigger.condition !== null && " · WHEN assumed true"}
        </>
      );
    case "skip":
      return (
        <>
          <Name>{trigger?.name}</Name> skipped · {step.reason}
          {onRow}
        </>
      );
    case "defer":
      return (
        <>
          <Name>{trigger?.name}</Name> queued · runs at COMMIT{onRow}
        </>
      );
    case "write":
      if (step.row === null) return "Table emptied";
      return event === "delete" ? `Row ${step.row} deleted` : `Row ${step.row} written`;
    case "unhandled":
      return `No INSTEAD OF ${event.toUpperCase()} trigger takes the rows, so this view's statement triggers don't run`;
    case "end":
      return event === "truncate" ? "Truncate done" : "All rows done";
    case "done":
      return "Statement finished";
  }
}

/** "What ran": every step played so far, numbered, newest at the bottom. */
export function RunLog({
  event,
  fade,
  log,
  whenAssumed,
}: {
  event: TriggerOperation;
  fade: Transition;
  log: readonly Step[];
  /** Some trigger on this lane has a WHEN condition, which playback cannot test. */
  whenAssumed: boolean;
}): React.ReactElement {
  const scroller = React.useRef<HTMLDivElement>(null);
  // Follows the newest line. A DOM position, not state: nothing else reads it.
  React.useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log.length]);

  return (
    <section aria-label="What ran" className="flex h-36 shrink-0 flex-col border-t">
      <h3 className="shrink-0 px-4 pt-2.5 pb-1.5 font-medium text-muted-foreground text-xs">
        What ran
        {whenAssumed && (
          <span className="font-normal">
            {" "}
            · playback can't test WHEN conditions, so it assumes they hold
          </span>
        )}
      </h3>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2.5" ref={scroller}>
        {log.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Press Play to watch this statement run, or Step through it.
          </p>
        ) : (
          <ol className="grid gap-0.5">
            {log.map((step, index) => (
              <motion.li
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex gap-2 text-muted-foreground text-xs",
                  step.kind === "skip" && "text-warning-foreground",
                  step.kind === "defer" && "text-info-foreground",
                )}
                initial={{ opacity: 0, y: 4 }}
                // Index keys are right here: the log only ever grows at the end or starts over.
                key={index}
                transition={fade}
              >
                <span className="w-5 shrink-0 text-end font-mono text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0">{lineFor(step, event)}</span>
              </motion.li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
