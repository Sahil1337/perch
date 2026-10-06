import type { Trigger, TriggerState } from "@perch/protocol";
import { ZapIcon } from "lucide-react";
import { motion, type Transition } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../../ui/badge";
import type { CardStatus } from "./lane-playback";
import { callWord, columnsWord } from "./trigger-labels";

/** Nothing for an ordinary enabled trigger: the badge is only there when the state is news. */
export function TriggerStateBadge({ state }: { state: TriggerState }): React.ReactElement | null {
  switch (state) {
    case "enabled":
      return null;
    case "disabled":
      return (
        <Badge size="sm" variant="secondary">
          Off
        </Badge>
      );
    case "replica":
      return (
        <Badge size="sm" variant="info">
          Replica
        </Badge>
      );
    case "always":
      return (
        <Badge size="sm" variant="outline">
          Always
        </Badge>
      );
  }
}

function statusWord(status: CardStatus): string {
  switch (status.kind) {
    case "firing":
      return "running…";
    case "ran":
      return status.rows.length === 0
        ? "ran"
        : `ran · ${status.rows.length === 1 ? "row" : "rows"} ${status.rows.join(", ")}`;
    case "skipped":
      return `skipped · ${status.reason}`;
    case "deferred":
      return "runs at COMMIT";
  }
}

const STATUS_TONE: Record<CardStatus["kind"], string> = {
  firing: "text-info-foreground",
  ran: "text-success-foreground",
  skipped: "text-warning-foreground",
  deferred: "text-info-foreground",
};

/** One trigger in its column: what it is called, what it runs, and when it would not. */
export function TriggerCard({
  fade,
  onSelect,
  selected,
  status,
  tableSchema,
  trigger,
}: {
  fade: Transition;
  onSelect: () => void;
  selected: boolean;
  /** Where playback has got to with this trigger; undefined before it has come up. */
  status: CardStatus | undefined;
  tableSchema: string;
  trigger: Trigger;
}): React.ReactElement {
  const off = trigger.state === "disabled";

  return (
    <motion.button
      animate={{ opacity: 1 }}
      className={cn(
        "grid w-full min-w-0 cursor-pointer gap-1 rounded-lg border bg-card px-2.5 py-2 text-left text-card-foreground outline-none",
        "transition-colors duration-200 hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-ring",
        status?.kind === "firing" && "border-info bg-info/10",
      )}
      initial={{ opacity: 0 }}
      onClick={onSelect}
      title={trigger.name}
      transition={fade}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ZapIcon
          className={cn(
            "size-3.5 shrink-0",
            off ? "text-muted-foreground" : "text-warning-foreground",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium font-mono text-xs",
            off && "text-muted-foreground line-through",
          )}
        >
          {trigger.name}
        </span>
        <TriggerStateBadge state={trigger.state} />
      </span>
      <span className="truncate font-mono text-muted-foreground text-xs">
        → {callWord(trigger, tableSchema)}
      </span>
      {trigger.columns.length > 0 && (
        <span className="text-muted-foreground text-xs">
          only when <span className="font-mono">{columnsWord(trigger.columns)}</span> is set
        </span>
      )}
      {trigger.condition !== null && (
        <span className="break-words font-mono text-muted-foreground text-xs">
          if {trigger.condition}
        </span>
      )}
      {status && (
        <span className={cn("text-xs transition-colors duration-200", STATUS_TONE[status.kind])}>
          {statusWord(status)}
        </span>
      )}
    </motion.button>
  );
}
