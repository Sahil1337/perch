import type { TriggerOperation } from "@perch/protocol";
import { PauseIcon, PlayIcon, RotateCcwIcon, StepForwardIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "../../ui/button";
import { Tabs, TabsList, TabsTab } from "../../ui/tabs";
import { MAX_ROWS } from "./lane-tempo";

const EVENTS: readonly { value: TriggerOperation; label: string }[] = [
  { value: "insert", label: "Insert" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "truncate", label: "Truncate" },
];

const ROW_CHOICES = Array.from({ length: MAX_ROWS }, (_, index) => String(index + 1));

function playLabel(playing: boolean, finished: boolean, started: boolean): string {
  if (playing) return "Pause";
  if (finished) return "Replay";
  return started ? "Resume" : "Play";
}

/** Which statement the lane plays, how many rows it touches, and the controls that play it. */
export function LaneToolbar({
  counts,
  event,
  finished,
  isView,
  onEvent,
  onRows,
  onStep,
  onToggle,
  playing,
  rows,
  started,
}: {
  /** Triggers on the table that fire on each event, whatever their slot. */
  counts: Record<TriggerOperation, number>;
  event: TriggerOperation;
  finished: boolean;
  isView: boolean;
  onEvent: (event: TriggerOperation) => void;
  onRows: (rows: number) => void;
  onStep: () => void;
  onToggle: () => void;
  playing: boolean;
  rows: number;
  started: boolean;
}): React.ReactElement {
  const label = playLabel(playing, finished, started);
  const Icon = playing ? PauseIcon : finished ? RotateCcwIcon : PlayIcon;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-3 pb-2">
      <Tabs onValueChange={(value) => onEvent(value as TriggerOperation)} value={event}>
        <TabsList aria-label="Event" size="sm">
          {EVENTS.map((item) => (
            <TabsTab
              // A view can't have TRUNCATE triggers, and TRUNCATE on a view is an error anyway.
              disabled={isView && item.value === "truncate"}
              key={item.value}
              value={item.value}
            >
              {item.label}
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                {counts[item.value]}
              </span>
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Rows</span>
        <Tabs onValueChange={(value) => onRows(Number(value))} value={String(rows)}>
          <TabsList aria-label="Rows the statement touches" size="sm">
            {ROW_CHOICES.map((value) => (
              // TRUNCATE has no rows to count: it empties the table in one step.
              <TabsTab disabled={event === "truncate"} key={value} value={value}>
                {value}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex items-center gap-1">
        <Button onClick={onToggle} size="xs" variant="outline">
          <Icon />
          {label}
        </Button>
        <Button onClick={onStep} size="xs" variant="ghost">
          <StepForwardIcon />
          Step
        </Button>
      </div>
    </div>
  );
}
