import type { Column } from "@perch/protocol";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  KeyRoundIcon,
  LayersIcon,
  Link2Icon,
  Table2Icon,
} from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";
import type { Point } from "./geometry";
import type { Node } from "./graph";

const KIND_ICON = {
  table: Table2Icon,
  view: EyeIcon,
  materialized_view: LayersIcon,
} as const;

export function TableCard({
  at,
  dim,
  dragging,
  node,
  onHover,
  onPointerDown,
  onToggle,
  referenced,
  selected,
  showSchema,
}: {
  at: Point;
  dim: boolean;
  dragging: boolean;
  node: Node;
  onHover: (key: string | null) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, key: string) => void;
  /** Opens or closes this card's hidden columns. */
  onToggle: (key: string) => void;
  /** Some other table points at this one's primary key. */
  referenced: boolean;
  selected: boolean;
  showSchema: boolean;
}): React.ReactElement {
  const { table } = node;
  const Icon = KIND_ICON[table.kind];

  // Which columns hold a foreign key, and where it points, for the row marker and its tooltip.
  const references = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const fk of table.foreignKeys) {
      fk.columns.forEach((column, index) => {
        map.set(column, `${fk.refTable}.${fk.refColumns[index] ?? fk.refColumns[0] ?? ""}`);
      });
    }
    return map;
  }, [table.foreignKeys]);

  return (
    <div
      className={cn(
        "absolute top-(--y) left-(--x) w-64 overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm/5",
        "transition-opacity duration-200",
        dragging ? "cursor-grabbing shadow-lg/10" : "cursor-grab",
        selected && "border-ring ring-2 ring-ring/40",
        dim && "opacity-40",
      )}
      data-selected={selected || undefined}
      onPointerDown={(event) => onPointerDown(event, node.key)}
      onPointerEnter={() => onHover(node.key)}
      onPointerLeave={() => onHover(null)}
      style={{ "--x": `${at.x}px`, "--y": `${at.y}px` } as React.CSSProperties}
    >
      <div className="flex h-8 items-center gap-1.5 border-b bg-muted/60 px-2.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium text-sm">
          {showSchema && <span className="text-muted-foreground">{table.schema}.</span>}
          {table.name}
        </span>
        {table.rowEstimate !== undefined && (
          <span className="ms-auto shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
            ~{table.rowEstimate}
          </span>
        )}
      </div>
      <div className="py-1">
        {node.rows.length === 0 ? (
          <div className="flex h-6 items-center px-2.5 text-muted-foreground text-xs">
            {table.columns.length === 0 ? "No columns" : "No keys"}
          </div>
        ) : (
          node.rows.map((column) => (
            <ColumnRow
              column={column}
              key={column.name}
              referenced={column.pk && referenced}
              reference={references.get(column.name)}
            />
          ))
        )}
        {node.footer && (
          // Opens this card alone. Stops the press here so it neither drags nor selects.
          <button
            className="flex h-6 w-full cursor-pointer items-center gap-1.5 px-2.5 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:text-foreground"
            onClick={() => onToggle(node.key)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {node.footer === "more" ? (
                <ChevronDownIcon className="size-3" />
              ) : (
                <ChevronUpIcon className="size-3" />
              )}
            </span>
            {node.footer === "more"
              ? `${node.hidden} more ${node.hidden === 1 ? "column" : "columns"}`
              : "Keys only"}
          </button>
        )}
      </div>
    </div>
  );
}

function ColumnRow({
  column,
  reference,
  referenced,
}: {
  column: Column;
  /** `table.column` this column points at, when it holds a foreign key. */
  reference: string | undefined;
  /** A primary key some other table points at. */
  referenced: boolean;
}): React.ReactElement {
  const title = [
    `${column.name} ${column.type}${column.nullable ? " NULL" : " NOT NULL"}`,
    column.pk ? "Primary key" : null,
    reference ? `References ${reference}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-6 items-center gap-1.5 px-2.5 text-xs" title={title}>
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {column.pk ? (
          <KeyRoundIcon
            className={cn(
              "size-3",
              referenced ? "text-warning-foreground" : "text-warning-foreground/70",
            )}
          />
        ) : reference ? (
          <Link2Icon className="size-3 text-info-foreground" />
        ) : (
          <span className="size-1 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          column.pk || reference ? "text-foreground" : "text-foreground/80",
        )}
      >
        {column.name}
      </span>
      <span className="ms-auto shrink-0 truncate font-mono text-muted-foreground tabular-nums">
        {column.type}
        {column.nullable && <span className="text-muted-foreground/60">?</span>}
      </span>
    </div>
  );
}
