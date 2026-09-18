"use client";

// Run history: "what did I just run, and did it work" is the question asked most often once the
// result has scrolled away. Backed by `runs` in the contract, which the live provider seeds from
// GET /api/history so it survives a reload.
//
// Grouped by day, because that is how people look for a query they have lost: not "the 43rd row
// down" but "sometime yesterday". Days collapse so a long history can be skimmed at the level of
// days first — and the count stays visible on a collapsed day, which is the only thing you can
// still learn about it without opening it.

import { Badge, clockOf, useWorkspace, type Run } from "@perch/ui";
import { ChevronRightIcon } from "lucide-react";
import * as React from "react";

/** Local midnight for the day `iso` falls in — the key runs are bucketed by. */
function dayKey(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

/**
 * "Today", "Yesterday", or the date. The year is only spelled out when it is not this one:
 * "Tue 15 Sep" reads faster, and an old run is the only case where the year carries information.
 */
function dayLabel(key: string): string {
  const day = new Date(key);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((midnight.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function Outcome({ run }: { run: Run }): React.ReactElement {
  if (run.status === "running") {
    return (
      <Badge size="sm" variant="outline">
        Running…
      </Badge>
    );
  }
  if (run.status === "error") {
    return (
      <Badge size="sm" variant="error">
        Error
      </Badge>
    );
  }
  if (run.status === "cancelled") {
    return (
      <Badge size="sm" variant="secondary">
        Cancelled
      </Badge>
    );
  }
  const rows = run.results?.reduce((total, result) => total + result.rowCount, 0) ?? 0;
  return (
    <Badge size="sm" variant="success">
      {rows} rows
    </Badge>
  );
}

export function RunHistory(): React.ReactElement {
  const { runs, selectRun } = useWorkspace();
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());

  // `runs` arrives newest first and stays that way; grouping preserves it, so the days come out
  // newest first too and each day's runs keep their order within it.
  const days = React.useMemo(() => {
    const byDay = new Map<string, Run[]>();
    for (const run of runs) {
      const key = dayKey(run.startedAt);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(run);
      else byDay.set(key, [run]);
    }
    return [...byDay.entries()];
  }, [runs]);

  if (runs.length === 0) {
    return <p className="p-3 text-muted-foreground text-sm">Nothing run yet.</p>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-1">
      {days.map(([key, dayRuns]) => {
        const open = !collapsed.has(key);
        return (
          <React.Fragment key={key}>
            <button
              aria-expanded={open}
              className="sticky top-0 z-10 flex h-7 cursor-pointer items-center gap-1.5 bg-sidebar px-2 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:bg-sidebar-accent"
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (!next.delete(key)) next.add(key);
                  return next;
                })
              }
              type="button"
            >
              <ChevronRightIcon
                aria-hidden
                className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
                  open ? "rotate-90" : ""
                }`}
              />
              <span className="min-w-0 truncate font-medium text-xs">{dayLabel(key)}</span>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums">
                {dayRuns.length}
              </span>
            </button>

            {open &&
              dayRuns.map((run) => (
                <button
                  className="flex cursor-pointer flex-col gap-1 rounded-sm px-2 py-1.5 ps-7 text-left outline-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
                  key={run.id}
                  onClick={() => selectRun(run.id)}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {clockOf(run.startedAt)}
                    </span>
                    <Outcome run={run} />
                  </span>
                  <span className="truncate font-mono text-muted-foreground text-xs">
                    {run.sql.split("\n")[0]}
                  </span>
                </button>
              ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}
