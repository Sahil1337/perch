// The lane: one column per stage of a statement, left to right in the order Postgres works through
// them, with a track across the top that the pulse travels along while the statement plays.

import type { Trigger, TriggerOperation } from "@perch/protocol";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { LaneColumn } from "./lane-column";
import type { LaneMotion } from "./lane-motion";
import {
  stagesFor,
  triggersAt,
  type LaneState,
  type RelationKind,
  type Slot,
  type StageId,
} from "./lane-playback";
import { LanePulse } from "./lane-pulse";

/**
 * The write column is Postgres's own step, with nothing to add to it, so it gets a fixed narrow
 * width and the trigger columns share the rest. A view has no write; its INSTEAD OF column does
 * the work and gets the extra room.
 */
const COLUMNS: Record<RelationKind, string> = {
  table: "1fr 1fr 7rem 1fr 1fr",
  view: "1fr 1.4fr 1fr",
};

const ROW_STAGES: ReadonlySet<StageId> = new Set(["before-row", "write", "instead-row"]);

export function FiringLane({
  event,
  kind,
  lane,
  motion,
  onAdd,
  onSelectTrigger,
  playing,
  rows,
  selectedName,
  selectedSlot,
  tableSchema,
  triggers,
}: {
  event: TriggerOperation;
  kind: RelationKind;
  lane: LaneState;
  motion: LaneMotion;
  onAdd: (slot: Slot) => void;
  onSelectTrigger: (trigger: Trigger) => void;
  /** Whether the pulse is drawn: while the statement is part-way through, playing or paused. */
  playing: boolean;
  rows: number;
  selectedName: string | null;
  /** The Add button a new trigger is being added at, if any. */
  selectedSlot: Slot | null;
  tableSchema: string;
  triggers: readonly Trigger[];
}): React.ReactElement {
  const stages = stagesFor(kind);
  const inRows = lane.stage !== null && ROW_STAGES.has(lane.stage) && lane.row !== null;
  const afterRowHasTriggers =
    triggersAt(triggers, { timing: "after", level: "row" }, event).length > 0;

  return (
    <div
      className="relative grid min-h-0 flex-1 grid-cols-(--lane-cols) content-start gap-x-3 gap-y-2 overflow-auto px-4 pt-3 pb-4"
      style={{ "--lane-cols": COLUMNS[kind] } as React.CSSProperties}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-4 top-5 h-0.5 -translate-y-1/2 rounded-full bg-border"
      />

      {stages.map((stage) => {
        const hit = lane.stage === stage.id;
        return (
          <div className="relative flex h-4 items-center justify-center" key={stage.id}>
            <span
              className={cn(
                "block size-3 rounded-full border-2 transition-colors duration-200",
                stage.id === "write" && "size-4 rounded-sm",
                hit ? "border-info bg-info" : "border-border bg-background",
              )}
            />
            {hit && playing && motion.pulse && <LanePulse transition={motion.pulse} />}
          </div>
        );
      })}

      {/* The per-row loop, spanning the columns a row passes through one at a time. A TRUNCATE has
          no rows, so the bracket goes with them. */}
      <div aria-hidden />
      {event === "truncate" ? (
        <div aria-hidden className={cn(kind === "table" && "col-span-2")} />
      ) : (
        <div
          className={cn(
            "relative mt-2 h-3 rounded-t-lg border-x border-t border-dashed",
            kind === "table" && "col-span-2",
          )}
        >
          <span className="absolute inset-x-0 -top-2.5 flex justify-center">
            <span
              className={cn(
                "bg-background px-2 text-xs transition-colors duration-200",
                inRows ? "text-info-foreground" : "text-muted-foreground",
              )}
            >
              for each row
              {inRows && ` · row ${lane.row} of ${rows}`}
            </span>
          </span>
        </div>
      )}
      <div aria-hidden />
      {kind === "table" && <div aria-hidden />}

      {stages.map((stage) => (
        <LaneColumn
          event={event}
          fade={motion.fade}
          key={stage.id}
          lane={lane}
          onAdd={onAdd}
          onSelectTrigger={onSelectTrigger}
          queued={stage.id === "after-row" && afterRowHasTriggers}
          selectedName={selectedName}
          slotSelected={
            stage.slot !== null &&
            selectedSlot !== null &&
            stage.slot.timing === selectedSlot.timing &&
            stage.slot.level === selectedSlot.level
          }
          stage={stage}
          tableSchema={tableSchema}
          triggers={stage.slot ? triggersAt(triggers, stage.slot, event) : []}
        />
      ))}
    </div>
  );
}
