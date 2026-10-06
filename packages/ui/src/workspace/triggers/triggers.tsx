import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { DatabaseSchema, Table, Trigger, TriggerOperation } from "@perch/protocol";
import { PlusIcon, XIcon } from "lucide-react";
import * as React from "react";
import { plural } from "../../lib/format";
import { Button } from "../../ui/button";
import { useWorkspace } from "../context";
import { asyncData } from "../types";
import { ExampleStatement } from "./example-statement";
import { FiringLane } from "./firing-lane";
import { LaneToolbar } from "./lane-toolbar";
import { useLaneMotion } from "./lane-motion";
import { buildSteps, laneAt, type Slot, type TriggerPreset } from "./lane-playback";
import { DEFAULT_ROWS } from "./lane-tempo";
import { RunLog } from "./run-log";
import { TableRail, tableKey } from "./table-rail";
import { TriggerDetail } from "./trigger-detail";
import { TriggerDrawer } from "./trigger-drawer";
import { ChangeFlash } from "./trigger-feedback";
import { TriggerForm } from "./trigger-form";
import { createValues, editValues, OPERATIONS } from "./trigger-form-values";
import type { TriggersFocus } from "./triggers-event";
import { useLanePlayback } from "./use-lane-playback";
import { atOf, useTriggerDrawer, type DrawerFace } from "./use-trigger-drawer";

/** What the dialog asks of the view before it closes. */
export type TriggersHandle = {
  /** Escape: closes what is open inside the view. False when nothing was, so the view closes. */
  dismiss(): boolean;
  /** Any other close: false when a form with changes asked first, so the view stays open. */
  release(): boolean;
};

/**
 * Every relation that can carry a trigger. Not materialized views, which can't; not partitions,
 * because their parent's row triggers fire on them but are listed on the parent.
 */
function laneTables(data: DatabaseSchema | undefined): Table[] {
  return (data?.schemas ?? []).flatMap((schema) =>
    schema.tables.filter((table) => table.kind !== "materialized_view" && !table.isPartition),
  );
}

function defaultEvent(table: Table): TriggerOperation {
  const has = (operation: TriggerOperation): boolean =>
    table.triggers.some((trigger) => trigger.operations.includes(operation));
  if (has("update")) return "update";
  const possible = (operation: TriggerOperation): boolean =>
    !(operation === "truncate" && table.kind === "view");
  return OPERATIONS.find((operation) => has(operation) && possible(operation)) ?? "insert";
}

/** The columns some UPDATE OF trigger on the table watches, in the table's column order. */
function watchedColumns(table: Table): string[] {
  const watched = new Set(
    table.triggers
      .filter((trigger) => trigger.operations.includes("update"))
      .flatMap((trigger) => trigger.columns),
  );
  return table.columns.map((column) => column.name).filter((name) => watched.has(name));
}

/**
 * Every watched column, so every UPDATE OF trigger fires; else one ordinary column. A view reports
 * no keys, so on one a column called `id` is passed over when there is anything else to set.
 */
function defaultSetColumns(table: Table): string[] {
  const watched = watchedColumns(table);
  if (watched.length > 0) return watched;
  const ordinary = table.columns.filter((column) => !column.pk);
  const first =
    (table.kind === "view" ? ordinary.find((column) => column.name !== "id") : undefined) ??
    ordinary[0] ??
    table.columns[0];
  return first ? [first.name] : [];
}

function Notice({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}

/**
 * The Triggers view: what fires when a table changes, in the order it fires. One table at a time,
 * one event at a time, laid out as the stages a statement goes through, with an example statement
 * to play through them.
 */
export function Triggers({
  focus,
  onClose,
  ref,
}: {
  focus: TriggersFocus | null;
  /** Closes the view, with no question asked: the caller has already decided. */
  onClose: () => void;
  ref?: React.Ref<TriggersHandle>;
}): React.ReactElement {
  const { connection, database, editBuffer, newScratch, refreshSchema, schema } = useWorkspace();
  const data = asyncData(schema);
  const motion = useLaneMotion();

  // The view is where people come right after changing a trigger by hand, so it never trusts the
  // cached tree. Once per open: the dialog mounts this afresh for every request.
  const refreshed = React.useRef(false);
  React.useEffect(() => {
    if (refreshed.current) return;
    refreshed.current = true;
    void refreshSchema();
  }, [refreshSchema]);

  const [pickedKey, setPickedKey] = React.useState<string | null>(null);
  const [eventChoice, setEventChoice] = React.useState<{
    table: string;
    event: TriggerOperation;
  } | null>(null);
  const [rows, setRows] = React.useState(DEFAULT_ROWS);
  const [setChoice, setSetChoice] = React.useState<{
    table: string;
    columns: readonly string[];
  } | null>(null);

  const tables = React.useMemo(() => laneTables(data), [data]);
  const qualify = (data?.schemas.length ?? 0) > 1;

  const table =
    tables.find((candidate) => tableKey(candidate) === pickedKey) ??
    (focus
      ? tables.find(
          (candidate) => candidate.schema === focus.schema && candidate.name === focus.table,
        )
      : undefined) ??
    tables.find((candidate) => candidate.triggers.length > 0) ??
    tables[0];
  const key = table ? tableKey(table) : null;

  const chosenEvent = eventChoice && eventChoice.table === key ? eventChoice.event : null;
  const event: TriggerOperation =
    table === undefined
      ? "insert"
      : chosenEvent && !(chosenEvent === "truncate" && table.kind === "view")
        ? chosenEvent
        : defaultEvent(table);

  const columnNames = React.useMemo(
    () => new Set(table?.columns.map((column) => column.name) ?? []),
    [table],
  );
  const setColumns = React.useMemo(() => {
    // A pick made on another table, or naming columns a refresh took away, falls back.
    const chosen =
      setChoice && setChoice.table === key
        ? setChoice.columns.filter((column) => columnNames.has(column))
        : [];
    return chosen.length > 0 ? chosen : table ? defaultSetColumns(table) : [];
  }, [columnNames, key, setChoice, table]);

  const steps = React.useMemo(
    () =>
      table
        ? buildSteps({
            triggers: table.triggers,
            kind: table.kind === "view" ? "view" : "table",
            event,
            rows,
            setColumns,
          })
        : [],
    [event, rows, setColumns, table],
  );
  const playback = useLanePlayback({
    steps,
    inputKey: JSON.stringify([key, event, rows, setColumns, data?.fetchedAt]),
    settled: data !== undefined && !(schema.status === "ready" && schema.stale),
  });
  const lane = React.useMemo(() => laneAt(steps, playback.index), [playback.index, steps]);

  const drawer = useTriggerDrawer({
    // A change landed: show its table, on an event the trigger fires on, so its card is in view.
    onShow: (changed, operations) => {
      const changedKey = tableKey(changed);
      setPickedKey(changedKey);
      if (!operations.includes(event) && operations[0]) {
        setEventChoice({ table: changedKey, event: operations[0] });
      }
    },
  });
  const face = drawer.face;

  const faceTable: Table | undefined =
    face === null
      ? undefined
      : tables.find((candidate) =>
          face.kind === "detail"
            ? candidate.schema === face.at.schema && candidate.name === face.at.table
            : tableKey(candidate) === face.values.table,
        );
  const shownTrigger: Trigger | null =
    face?.kind === "detail"
      ? (faceTable?.triggers.find((trigger) => trigger.name === face.at.name) ?? face.submitted)
      : null;

  const selectedName: string | null =
    face?.kind === "detail" && faceTable === table
      ? face.at.name
      : face?.kind === "form" && face.original && faceTable === table
        ? face.original.name
        : null;
  const selectedSlot: Slot | null =
    face?.kind === "form" &&
    face.slot !== null &&
    face.slot.schema === table?.schema &&
    face.slot.table === table.name &&
    face.slot.operation === event
      ? face.slot
      : null;

  // Only what can be seen takes an Escape: a press that changes nothing on screen reads as a
  // press that did not register.
  React.useImperativeHandle(ref, () => ({
    dismiss: drawer.dismiss,
    release: () => drawer.release(onClose),
  }));

  const openForm = (next: Omit<Extract<DrawerFace, { kind: "form" }>, "kind" | "initial">): void =>
    drawer.go({ face: { kind: "form", ...next, initial: next.values } });

  const openInEditor = (sql: string): void => {
    const id = newScratch();
    editBuffer(id, sql);
    onClose();
  };

  const pickTable = (next: Table): void =>
    drawer.go({
      face: null,
      then: () => {
        playback.touch();
        setPickedKey(tableKey(next));
      },
    });
  const pickEvent = (next: TriggerOperation): void => {
    if (!key) return;
    playback.touch();
    setEventChoice({ table: key, event: next });
  };
  const pickRows = (next: number): void => {
    playback.touch();
    setRows(next);
  };
  const pickColumns = (columns: string[]): void => {
    if (!key) return;
    playback.touch();
    setSetChoice({ table: key, columns });
  };

  const onAddTrigger = (preset: TriggerPreset): void => {
    if (!table) return;
    openForm({ original: null, slot: preset, values: createValues(table, preset) });
  };
  const onNewTrigger = (): void => {
    if (!table) return;
    openForm({ original: null, slot: null, values: createValues(table, { operation: event }) });
  };

  const mysql = connection?.dialect === "mysql";
  const triggerCount = tables.reduce((total, candidate) => total + candidate.triggers.length, 0);
  const withTriggers = tables.filter((candidate) => candidate.triggers.length > 0).length;
  const counts = Object.fromEntries(
    OPERATIONS.map((operation) => [
      operation,
      table?.triggers.filter((trigger) => trigger.operations.includes(operation)).length ?? 0,
    ]),
  ) as Record<TriggerOperation, number>;

  const body = (): React.ReactNode => {
    if (!connection) return <Notice>Connect to a database to see its triggers.</Notice>;
    if (mysql) return <Notice>Triggers are Postgres-only for now.</Notice>;
    if (data === undefined) {
      return <Notice>{schema.status === "error" ? schema.error : "Loading schema…"}</Notice>;
    }
    if (!table) return <Notice>No tables in this database.</Notice>;
    const kind = table.kind === "view" ? "view" : "table";

    return (
      <div className="relative flex min-h-0 flex-1">
        <TableRail onPick={pickTable} qualify={qualify} selectedKey={key} tables={tables} />
        <section aria-label="Firing order" className="flex min-w-0 flex-1 flex-col bg-background">
          <LaneToolbar
            counts={counts}
            event={event}
            finished={playback.finished}
            isView={kind === "view"}
            onEvent={pickEvent}
            onRows={pickRows}
            onStep={playback.step}
            onToggle={playback.toggle}
            playing={playback.playing}
            rows={rows}
            started={playback.index >= 0}
          />
          <ExampleStatement
            event={event}
            onSetColumns={pickColumns}
            qualify={qualify}
            rows={rows}
            setColumns={setColumns}
            table={table}
            watched={new Set(watchedColumns(table))}
          />
          <FiringLane
            event={event}
            kind={kind}
            lane={lane}
            motion={motion}
            onAdd={(slot) =>
              onAddTrigger({ ...slot, schema: table.schema, table: table.name, operation: event })
            }
            onSelectTrigger={(trigger) =>
              drawer.go({
                face: { kind: "detail", at: atOf(table, trigger.name), submitted: null },
              })
            }
            playing={playback.index >= 0 && !playback.finished}
            rows={rows}
            selectedName={selectedName}
            selectedSlot={selectedSlot}
            tableSchema={table.schema}
            triggers={table.triggers}
          />
          <RunLog
            event={event}
            fade={motion.fade}
            log={lane.log}
            whenAssumed={table.triggers.some(
              (trigger) => trigger.condition !== null && trigger.operations.includes(event),
            )}
          />
        </section>
        <TriggerDrawer
          closeDisabled={drawer.pending}
          faceKey={String(drawer.opened)}
          label={
            face?.kind === "form"
              ? face.original
                ? "Edit trigger"
                : "New trigger"
              : "Trigger details"
          }
          motion={motion}
          onClose={() => drawer.go({ face: null })}
          open={face !== null}
          title={drawerTitle()}
        >
          {drawerFace(data)}
        </TriggerDrawer>
      </div>
    );
  };

  const drawerTitle = (): React.ReactNode => {
    if (face?.kind !== "form") return "Trigger";
    if (face.original) {
      return (
        <>
          Edit <span className="font-mono">{face.original.name}</span>
        </>
      );
    }
    return (
      <>
        New trigger on{" "}
        <span className="font-mono">
          {faceTable ? (qualify ? tableKey(faceTable) : faceTable.name) : face.values.table}
        </span>
      </>
    );
  };

  const drawerFace = (loaded: DatabaseSchema): React.ReactNode => {
    if (face === null) return null;
    if (!faceTable) return <Notice>That table no longer exists.</Notice>;
    if (face.kind === "form") {
      return (
        <TriggerForm
          drawer={drawer}
          face={face}
          onOpenInEditor={openInEditor}
          qualify={qualify}
          schema={loaded}
          table={faceTable}
          tables={tables}
        />
      );
    }
    if (!shownTrigger) return <Notice>That trigger no longer exists.</Notice>;
    return (
      <TriggerDetail
        drawer={drawer}
        onEdit={() =>
          openForm({
            original: shownTrigger,
            slot: null,
            values: editValues(faceTable, shownTrigger),
          })
        }
        onOpenInEditor={openInEditor}
        qualify={qualify}
        schema={loaded}
        table={faceTable}
        trigger={shownTrigger}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg/5">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="font-medium text-sm leading-none">
            Triggers
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 truncate text-muted-foreground text-xs">
            {database ?? "No database"}
            {data !== undefined && !mysql && (
              <>
                {" · "}
                {triggerCount === 0
                  ? "no triggers yet"
                  : `${plural(triggerCount, "trigger")} on ${plural(withTriggers, "table")}`}
                {" · internal triggers hidden"}
              </>
            )}
          </DialogPrimitive.Description>
        </div>
        {drawer.flash && drawer.flash.at === null && <ChangeFlash text={drawer.flash.text} />}
        <Button disabled={!table || mysql || !connection} onClick={onNewTrigger} size="xs">
          <PlusIcon />
          New trigger
        </Button>
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
        <DialogPrimitive.Close
          aria-label="Close"
          render={<Button size="icon-sm" variant="ghost" />}
        >
          <XIcon />
        </DialogPrimitive.Close>
      </header>
      {body()}
    </div>
  );
}
