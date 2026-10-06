import type { Table, TriggerOperation } from "@perch/protocol";
import { quoteIdent } from "@perch/sql";
import { ChevronDownIcon, ZapIcon } from "lucide-react";
import type * as React from "react";
import { plural } from "../../lib/format";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { highlightSql } from "../sql-editor/highlight-sql";

/** Quoted exactly as the SQL the view runs quotes it, so the example reads like the real thing. */
const ident = (name: string): string => quoteIdent(name, "postgres");

/**
 * The statement the lane plays, written out. The rows and values are elided rather than invented:
 * what matters to a trigger is the kind of statement, how many rows, and for an UPDATE, which
 * columns it sets — and that last part is the picker.
 */
export function ExampleStatement({
  event,
  onSetColumns,
  qualify,
  rows,
  setColumns,
  table,
  watched,
}: {
  event: TriggerOperation;
  onSetColumns: (columns: string[]) => void;
  /** Name the schema too, because the view is showing more than one. */
  qualify: boolean;
  rows: number;
  setColumns: readonly string[];
  table: Table;
  /** Columns some UPDATE OF trigger on this table watches. */
  watched: ReadonlySet<string>;
}): React.ReactElement {
  const name = qualify ? `${ident(table.schema)}.${ident(table.name)}` : ident(table.name);
  const matching = ` -- ${plural(rows, "row")}`;

  const toggle = (column: string, checked: boolean): void => {
    const next = new Set(setColumns);
    if (checked) next.add(column);
    else next.delete(column);
    // Kept in the table's column order, whatever order they were ticked in.
    onSetColumns(table.columns.map((c) => c.name).filter((c) => next.has(c)));
  };

  return (
    <div className="mx-4 flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
      <span className="font-sans text-muted-foreground">Example</span>
      {event === "insert" && (
        <code>
          {highlightSql(
            `INSERT INTO ${name} VALUES ${Array.from({ length: rows }, () => "(…)").join(", ")};`,
          )}
        </code>
      )}
      {event === "delete" && <code>{highlightSql(`DELETE FROM ${name} WHERE …;${matching}`)}</code>}
      {event === "truncate" && <code>{highlightSql(`TRUNCATE ${name};`)}</code>}
      {event === "update" && (
        <code>
          {highlightSql(`UPDATE ${name} SET `)}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label="Columns this UPDATE sets"
                  className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm underline decoration-dashed decoration-muted-foreground underline-offset-4 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                />
              }
            >
              {highlightSql(setColumns.map((column) => `${ident(column)} = …`).join(", "))}
              <ChevronDownIcon className="size-3 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Columns this UPDATE sets</DropdownMenuLabel>
                {table.columns.map((column) => {
                  const checked = setColumns.includes(column.name);
                  return (
                    <DropdownMenuCheckboxItem
                      checked={checked}
                      // An UPDATE sets at least one column.
                      disabled={checked && setColumns.length === 1}
                      key={column.name}
                      onCheckedChange={(next) => toggle(column.name, next)}
                    >
                      <span className="truncate font-mono">{column.name}</span>
                      {watched.has(column.name) && (
                        <ZapIcon
                          aria-label="An UPDATE OF trigger watches this column"
                          className="size-3 text-warning-foreground"
                        />
                      )}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {highlightSql(` WHERE …;${matching}`)}
        </code>
      )}
    </div>
  );
}
