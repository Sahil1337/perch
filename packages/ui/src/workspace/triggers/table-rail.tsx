import type { Table } from "@perch/protocol";
import { ZapIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Input } from "../../ui/input";
import { KIND_ICON } from "../schema-tree/utils";

export const tableKey = (table: Table): string => `${table.schema}.${table.name}`;

function RailItem({
  onPick,
  qualify,
  selected,
  table,
}: {
  onPick: (table: Table) => void;
  qualify: boolean;
  selected: boolean;
  table: Table;
}): React.ReactElement {
  const Icon = KIND_ICON[table.kind];
  const count = table.triggers.length;
  const label = qualify ? tableKey(table) : table.name;

  return (
    <button
      aria-current={selected || undefined}
      className={cn(
        "flex h-7 w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-muted-foreground text-sm outline-none",
        "transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent text-foreground",
      )}
      onClick={() => onPick(table)}
      title={label}
      type="button"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 rounded-sm bg-warning/10 px-1 font-mono text-warning-foreground text-xs tabular-nums">
          <ZapIcon className="size-3" />
          {count}
        </span>
      )}
    </button>
  );
}

function RailHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h3 className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs">{children}</h3>;
}

/**
 * Every table that can have triggers, the ones that do first. The rest can be long on a real
 * database, so only they get a filter: the tables with triggers are the short list people came for.
 */
export function TableRail({
  onPick,
  qualify,
  selectedKey,
  tables,
}: {
  onPick: (table: Table) => void;
  qualify: boolean;
  selectedKey: string | null;
  tables: readonly Table[];
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const withTriggers = tables.filter((table) => table.triggers.length > 0);
  const without = tables.filter((table) => table.triggers.length === 0);
  const shown = without.filter(
    (table) => needle === "" || tableKey(table).toLowerCase().includes(needle),
  );

  const item = (table: Table): React.ReactElement => (
    <RailItem
      key={tableKey(table)}
      onPick={onPick}
      qualify={qualify}
      selected={selectedKey === tableKey(table)}
      table={table}
    />
  );

  return (
    <nav
      aria-label="Tables"
      className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-e px-2 pt-1 pb-3"
    >
      <RailHeading>Tables with triggers</RailHeading>
      {withTriggers.length === 0 ? (
        <p className="px-2 pb-1 text-muted-foreground text-xs">None yet.</p>
      ) : (
        withTriggers.map(item)
      )}

      {without.length > 0 && (
        <>
          <RailHeading>No triggers yet</RailHeading>
          <div className="px-1 pb-1">
            <Input
              aria-label="Filter tables without triggers"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter tables"
              size="sm"
              type="search"
              value={query}
            />
          </div>
          {shown.length === 0 ? (
            <p className="px-2 py-1 text-muted-foreground text-xs">
              No tables match “{query.trim()}”.
            </p>
          ) : (
            shown.map(item)
          )}
        </>
      )}
    </nav>
  );
}
