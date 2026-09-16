"use client";

// The schema sidebar: two levels, table → column. Deeper nesting would add rows the user has to
// open before seeing anything — the database is already named in the topbar, and a table's kind is
// an icon's worth of information, not a folder. The schema level is conditional, because it is the
// only one that sometimes carries information; see `needsSchemaLevel`.
//
// Async rendering follows the rule in types.ts: a populated tree is never replaced by a skeleton.

import type { Column, DatabaseSchema, Table } from "@perch/protocol";
import {
  ChevronRightIcon,
  EyeIcon,
  KeyIcon,
  LayersIcon,
  RefreshCwIcon,
  Table2Icon,
  TriangleAlertIcon,
  WaypointsIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCollapse, useFade } from "../lib/motion";
import * as React from "react";
import { cn } from "../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useWorkspace } from "./context";
import { requestSchemaDiagram } from "./schema-diagram";
import { asyncData } from "./types";

/** Pixels. Indentation is the one row value that depends on data, so it is the one inline value. */
const INDENT_BASE = 8;
const INDENT_STEP = 12;

const SKELETON_ROWS = 6;

const KIND_ICON = {
  table: Table2Icon,
  view: EyeIcon,
  // Distinct from a plain view on purpose: a matview is stored rows, not a saved query.
  materialized_view: LayersIcon,
} as const;

/**
 * Whether the schema name is worth a row of its own. One schema makes it a constant — `public` on
 * Postgres, the database itself on MySQL — costing an indent level and a click to say nothing.
 *
 * Decided from the full response, not the filtered one, so typing cannot reshape the tree.
 */
function needsSchemaLevel(schema: DatabaseSchema | undefined): boolean {
  return (schema?.schemas.length ?? 0) > 1;
}

export function SchemaTree({
  className,
  onPickTable,
}: {
  className?: string;
  /** Called with the table a click landed on, in addition to toggling its columns. */
  onPickTable?: (table: Table) => void;
}): React.ReactElement {
  const { schema, refreshSchema } = useWorkspace();
  const data = asyncData(schema);

  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  // Schemas open, tables shut: the schema level only exists when there are several to skim, and
  // opening every table would bury the list under its own columns.
  const [collapsedSchemas, setCollapsedSchemas] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expandedTables, setExpandedTables] = React.useState<ReadonlySet<string>>(() => new Set());

  const needle = query.trim().toLowerCase();
  const showSchemas = needsSchemaLevel(data);
  const refreshing = schema.status === "ready" && schema.stale;

  const groups = React.useMemo(() => {
    const all = data?.schemas ?? [];
    return all
      .map((entry) => ({
        name: entry.name,
        tables: entry.tables.filter(
          (table) => needle === "" || table.name.toLowerCase().includes(needle),
        ),
      }))
      // An empty schema is noise, but the level stays, so depth does not shift while typing.
      .filter((entry) => entry.tables.length > 0);
  }, [data, needle]);

  const matchCount = groups.reduce((total, entry) => total + entry.tables.length, 0);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-1.5 p-2">
        <Input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tables"
          size="sm"
          type="search"
          value={query}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Refresh schema"
                disabled={refreshing}
                onClick={() => void refreshSchema()}
                size="icon-xs"
                variant="ghost"
              >
                <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
              </Button>
            }
          />
          <TooltipPopup>{refreshing ? "Refreshing…" : "Refresh schema"}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Visualise relationships"
                disabled={data === undefined}
                // Opens on the selected table when there is one, so the picture starts where
                // the tree was looking.
                onClick={() => requestSchemaDiagram(selected ?? undefined)}
                size="icon-xs"
                variant="ghost"
              >
                <WaypointsIcon />
              </Button>
            }
          />
          <TooltipPopup>Visualise relationships</TooltipPopup>
        </Tooltip>
      </div>

      {schema.status === "error" && (
        <p
          className="flex shrink-0 items-start gap-1.5 border-destructive/24 border-y bg-destructive/8 px-2 py-1.5 text-destructive-foreground text-xs"
          role="alert"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="min-w-0">{schema.error}</span>
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {data === undefined ? (
          <SchemaSkeleton />
        ) : matchCount === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            {needle === "" ? "No tables in this database." : `No tables match “${query.trim()}”.`}
          </p>
        ) : (
          groups.map((group) => {
            const open = !collapsedSchemas.has(group.name);
            const tables = (
              <TableRows
                depth={showSchemas ? 1 : 0}
                expanded={expandedTables}
                onPickTable={onPickTable}
                onSelect={setSelected}
                onToggle={setExpandedTables}
                selected={selected}
                tables={group.tables}
              />
            );

            if (!showSchemas) return <React.Fragment key={group.name}>{tables}</React.Fragment>;

            return (
              <React.Fragment key={group.name}>
                <TreeRow
                  depth={0}
                  expanded={open}
                  icon={<LayersIcon className="size-3.5" />}
                  label={group.name}
                  onClick={() => setCollapsedSchemas((previous) => toggle(previous, group.name))}
                  trailing={<Hint>{group.tables.length}</Hint>}
                />
                <Disclosure open={open}>{tables}</Disclosure>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ rows */

function TableRows({
  depth,
  expanded,
  onPickTable,
  onSelect,
  onToggle,
  selected,
  tables,
}: {
  depth: number;
  expanded: ReadonlySet<string>;
  onPickTable?: (table: Table) => void;
  onSelect: (key: string) => void;
  onToggle: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  selected: string | null;
  tables: readonly Table[];
}): React.ReactElement {
  return (
    <>
      {tables.map((table) => {
        const key = `${table.schema}.${table.name}`;
        const open = expanded.has(key);
        const Icon = KIND_ICON[table.kind];

        return (
          <React.Fragment key={key}>
            <TreeRow
              depth={depth}
              expanded={open}
              icon={<Icon className="size-3.5" />}
              label={table.name}
              onClick={() => {
                onToggle((previous) => toggle(previous, key));
                onSelect(key);
                onPickTable?.(table);
              }}
              selected={selected === key}
              trailing={
                <>
                  {table.kind === "materialized_view" && (
                    // A matview holds a snapshot, not the current answer.
                    <Badge
                      aria-label="Materialized view — a snapshot until the next REFRESH"
                      size="sm"
                      title="Materialized view — a snapshot until the next REFRESH"
                      variant="secondary"
                    >
                      MAT
                    </Badge>
                  )}
                  {table.rowEstimate !== undefined && <Hint>~{table.rowEstimate}</Hint>}
                </>
              }
            />
            <Disclosure open={open}>
              {table.columns.map((column) => (
                <ColumnRow column={column} depth={depth + 1} key={column.name} />
              ))}
            </Disclosure>
          </React.Fragment>
        );
      })}
    </>
  );
}

/**
 * A column. Not a focus stop: the actionable row is the table above it, and a tab stop that does
 * nothing is noise in a tree hundreds of rows long. Nullability rides on the type as `text?`.
 */
function ColumnRow({ column, depth }: { column: Column; depth: number }): React.ReactElement {
  return (
    <div
      className="flex h-7 w-full items-center gap-1.5 pe-2 ps-(--tree-indent) text-sm"
      style={{ "--tree-indent": indent(depth) } as React.CSSProperties}
      title={`${column.name} ${column.type}${column.nullable ? " NULL" : " NOT NULL"}`}
    >
      <span className="size-3.5 shrink-0" />
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {column.pk ? (
          <KeyIcon className="size-3 text-warning-foreground" />
        ) : (
          <span className="size-1 rounded-full bg-muted-foreground/50" />
        )}
      </span>
      <span className="truncate text-muted-foreground">{column.name}</span>
      <Hint>
        {column.type}
        {column.nullable && <span className="text-muted-foreground/60">?</span>}
      </Hint>
    </div>
  );
}

function TreeRow({
  depth,
  expanded,
  icon,
  label,
  onClick,
  selected = false,
  trailing,
}: {
  depth: number;
  /** `undefined` for a row with nothing to open. */
  expanded?: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  selected?: boolean;
  trailing?: React.ReactNode;
}): React.ReactElement {
  const fade = useFade();

  return (
    <button
      aria-expanded={expanded}
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded-sm pe-2 ps-(--tree-indent) text-left text-sm",
        // The focus ring is drawn inside the row: rows run the full width of a scrolling pane, so
        // an outward ring would be clipped on both edges.
        "-outline-offset-2 cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring",
        "hover:bg-sidebar-accent/60",
        selected && "bg-sidebar-accent",
      )}
      onClick={onClick}
      style={{ "--tree-indent": indent(depth) } as React.CSSProperties}
      type="button"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {expanded !== undefined && (
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            initial={false}
            transition={fade}
          >
            <ChevronRightIcon className="size-3.5" />
          </motion.span>
        )}
      </span>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="ms-auto shrink-0 truncate font-mono text-muted-foreground text-xs tabular-nums">
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- disclosure */

function Disclosure({
  children,
  open,
}: {
  children: React.ReactNode;
  open: boolean;
}): React.ReactElement {
  const collapse = useCollapse();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={collapse}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SchemaSkeleton(): React.ReactElement {
  return (
    <div aria-label="Loading schema" role="status">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div className="flex h-7 items-center gap-1.5 ps-6 pe-2" key={index}>
          <Skeleton className="size-3.5 shrink-0" />
          <Skeleton className="h-3 w-32 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ util */

/**
 * Row indentation: the only value here Tailwind cannot hold, because it is a function of the row's
 * depth. It is fed to a `--tree-indent` custom property at each call site so the padding stays a
 * utility class and only the number is inline.
 */
function indent(depth: number): string {
  return `${INDENT_BASE + depth * INDENT_STEP}px`;
}

function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
