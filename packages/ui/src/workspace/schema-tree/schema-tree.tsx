"use client";

// The schema sidebar: two levels, table → column. Deeper nesting would add rows the user has to
// open before seeing anything — the database is already named in the topbar, and a table's kind is
// an icon's worth of information, not a folder. The schema level is conditional, because it is the
// only one that sometimes carries information; see `needsSchemaLevel`.
//
// Async rendering follows the rule in types.ts: a populated tree is never replaced by a skeleton.

import type { Table } from "@perch/protocol";
import { LayersIcon, RefreshCwIcon, TriangleAlertIcon, WaypointsIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { useWorkspace } from "../context";
import { requestSchemaDiagram } from "../schema-diagram";
import { asyncData } from "../types";
import { Disclosure, SchemaSkeleton } from "./disclosure";
import { Hint, TableRows, TreeRow } from "./rows";
import { needsSchemaLevel, toggle } from "./utils";

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
    return (
      all
        .map((entry) => ({
          name: entry.name,
          tables: entry.tables.filter(
            (table) => needle === "" || table.name.toLowerCase().includes(needle),
          ),
        }))
        // An empty schema is noise, but the level stays, so depth does not shift while typing.
        .filter((entry) => entry.tables.length > 0)
    );
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
