// Run history: "what did I just run, and did it work" is the question asked most often once the
// result has scrolled away. Backed by `runs` in the contract, which the live provider seeds from
// GET /api/history so it survives a reload.
//
// Grouped by day, because that is how people look for a query they have lost: not "the 43rd row
// down" but "sometime yesterday". Days collapse so a long history can be skimmed at the level of
// days first — and the count stays visible on a collapsed day, which is the only thing you can
// still learn about it without opening it.
//
// Scoped to a folder, because the other way people look for a lost query is "the one I ran on that
// project" — and a machine with four checkouts open over a year has one history in which none of
// them can be found.

import type { HistoryScope } from "@perch/protocol";
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  PerchMark,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  clockOf,
  asyncData,
  requestSettings,
  useWorkspace,
  type Run,
} from "@perch/ui";
import { ChevronRightIcon } from "lucide-react";
import * as React from "react";

/**
 * Which runs to show. "This folder" is the default and includes the runs that belong to no folder:
 * a scratch query is part of what you were doing in this project even though no file holds it.
 */
const SCOPES: Readonly<Record<HistoryScope, string>> = {
  workspace: "This folder",
  all: "All runs",
  global: "No folder",
};

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

/**
 * One run. The row opens it in the results pane, where the query itself is now shown above its
 * results; the context menu is for the two things you cannot do by looking.
 *
 * A menu rather than buttons on the row: the row is itself a button, a button inside a button is
 * not valid markup, and hover-revealed actions would have to push the SQL aside to make room for
 * something wanted once in fifty rows.
 *
 * "Run again" runs against whatever connection is selected now, not the one it ran on — a past run
 * is a query you want to repeat, and switching connections underneath someone is the more
 * surprising of the two readings.
 */
function RunRow({
  run,
  onSelect,
  onRunAgain,
}: {
  run: Run;
  onSelect: (runId: string) => void;
  onRunAgain: (sql: string) => Promise<string | undefined>;
}): React.ReactElement {
  return (
    <ContextMenu>
      {/* The styling goes on the button, not the trigger: the trigger owns its own shape, and the
          linter enforces it. */}
      <ContextMenuTrigger
        onClick={() => onSelect(run.id)}
        render={
          <button
            className="flex cursor-pointer flex-col gap-1 rounded-sm px-2 py-1.5 ps-7 text-left outline-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
            type="button"
          />
        }
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            {clockOf(run.startedAt)}
          </span>
          <Outcome run={run} />
        </span>
        {/* The whole query in the tooltip: the sidebar is 180px, so the line below can only ever be
            the first few words of it. */}
        <span className="truncate font-mono text-muted-foreground text-xs" title={run.sql}>
          {run.sql.split("\n")[0]}
        </span>
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <ContextMenuItem onClick={() => void onRunAgain(run.sql)}>Run again</ContextMenuItem>
        <ContextMenuItem onClick={() => void navigator.clipboard?.writeText(run.sql)}>
          Copy SQL
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}

export function RunHistory(): React.ReactElement {
  const { runs, selectRun, run: runSql, historyScope, setHistoryScope, settings } = useWorkspace();
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());

  // Only once settings have actually loaded: undefined is "not known yet", and answering it with
  // the off screen would flash "history is off" over a history that is about to arrive.
  const recording = asyncData(settings)?.historyMode;

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

  // Nothing is being recorded, so there is no empty list to explain and no scope to pick within
  // it. The panel says which setting did this and opens it: a screen that is blank *by a setting*
  // should hand you the setting rather than leave you to find it.
  if (recording === "off") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {/* The mark, muted: the colour belongs to the span, because the mark owns its own. */}
            <span className="text-muted-foreground">
              <PerchMark className="size-4.5" />
            </span>
          </EmptyMedia>
          <EmptyTitle>Nothing is recorded</EmptyTitle>
          <EmptyDescription>Runs are not written down, so this panel stays empty.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => requestSettings("history")} size="xs" variant="outline">
            Turn on history
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* The picker stays on an empty list: "nothing run yet" and "nothing run yet in this folder"
          are different statements, and the way to tell them apart should not be to run something. */}
      <div className="shrink-0 px-2 py-1.5">
        <Select
          items={SCOPES}
          onValueChange={(value) => setHistoryScope(value as HistoryScope)}
          value={historyScope}
        >
          <SelectTrigger className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {Object.entries(SCOPES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>

      {runs.length === 0 ? (
        <p className="px-3 py-2 text-muted-foreground text-sm">
          {historyScope === "all" ? "Nothing run yet." : "Nothing run here yet."}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-1">
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
                  dayRuns.map((entry) => (
                    <RunRow key={entry.id} onRunAgain={runSql} onSelect={selectRun} run={entry} />
                  ))}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
