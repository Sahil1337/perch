import type { Trigger, TriggerOperation } from "@perch/protocol";
import { CheckIcon, PlusIcon } from "lucide-react";
import { motion, type Transition } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import type { LaneState, Slot, Stage } from "./lane-playback";
import { TriggerCard } from "./trigger-card";

const WRITE_COPY: Record<TriggerOperation, { title: string; why: string }> = {
  insert: { title: "Row written", why: "Postgres inserts the row here." },
  update: { title: "Row written", why: "Postgres writes the new version of the row here." },
  delete: { title: "Row deleted", why: "Postgres deletes the row here." },
  truncate: { title: "Table emptied", why: "Every row goes at once, with no step per row." },
};

function slotWord(slot: Slot): string {
  const timing = slot.timing === "instead_of" ? "instead of" : slot.timing;
  return `Add ${timing} ${slot.level} trigger`;
}

function RowChip({
  done,
  fade,
  row,
}: {
  done: boolean;
  fade: Transition;
  row: number | null;
}): React.ReactElement {
  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 font-mono text-xs transition-colors duration-200",
        done ? "bg-success/10 text-success-foreground" : "bg-muted text-muted-foreground",
      )}
      initial={{ opacity: 0, scale: 0.9 }}
      transition={fade}
    >
      {done && <CheckIcon className="size-3" />}
      {row === null ? "emptied" : `row ${row}`}
    </motion.span>
  );
}

/** One stage of the statement: its title, the triggers that run there, and where to add one. */
export function LaneColumn({
  event,
  fade,
  lane,
  onAdd,
  onSelectTrigger,
  queued,
  selectedName,
  slotSelected,
  stage,
  tableSchema,
  triggers,
}: {
  event: TriggerOperation;
  fade: Transition;
  lane: LaneState;
  onAdd: (slot: Slot) => void;
  onSelectTrigger: (trigger: Trigger) => void;
  /** Show the rows waiting on this column's triggers. Only the after-row column queues. */
  queued: boolean;
  selectedName: string | null;
  /** The Add button here is the slot a new trigger is being added at. */
  slotSelected: boolean;
  stage: Stage;
  tableSchema: string;
  triggers: readonly Trigger[];
}): React.ReactElement {
  if (stage.slot === null) {
    const copy = WRITE_COPY[event];
    return (
      <div className="flex min-w-0 flex-col items-center gap-1 text-center">
        <h3 className="font-medium text-sm">{copy.title}</h3>
        <p className="text-muted-foreground text-xs">{copy.why}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {lane.written.map((row) => (
            <RowChip done fade={fade} key={row} row={row} />
          ))}
          {lane.emptied && <RowChip done fade={fade} row={null} />}
        </div>
      </div>
    );
  }

  const { slot } = stage;
  const rowsOnly = event === "truncate" && slot.level === "row";

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium text-sm">{stage.title}</h3>
        <span className="font-mono text-muted-foreground text-xs uppercase">
          {slot.timing === "instead_of" ? "instead of" : slot.timing} · {slot.level}
        </span>
        <p className="text-muted-foreground text-xs">{stage.why}</p>
      </div>

      {queued && lane.written.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lane.written.map((row) => (
            <RowChip done={lane.drained.includes(row)} fade={fade} key={row} row={row} />
          ))}
        </div>
      )}

      {triggers.map((trigger) => (
        <TriggerCard
          fade={fade}
          key={trigger.name}
          onSelect={() => onSelectTrigger(trigger)}
          selected={selectedName === trigger.name}
          status={lane.cards.get(trigger.name)}
          tableSchema={tableSchema}
          trigger={trigger}
        />
      ))}

      {rowsOnly ? (
        <p className="text-muted-foreground text-xs">TRUNCATE only runs statement triggers.</p>
      ) : (
        <button
          aria-pressed={slotSelected}
          className={cn(
            "flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed text-muted-foreground text-xs outline-none",
            "transition-colors duration-200 hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            slotSelected && "border-ring bg-accent text-foreground",
          )}
          onClick={() => onAdd(slot)}
          type="button"
        >
          <PlusIcon className="size-3.5" />
          {slotWord(slot)}
        </button>
      )}
    </div>
  );
}
