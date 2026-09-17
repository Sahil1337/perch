// What the palette lists, apart from the commands.
//
// Four pure builders, one per group, over data the caller has already unwrapped with `asyncData` —
// the last value that loaded, whatever the status, because a palette that renders nothing until the
// schema arrives feels broken on the first ⌘K. Nothing here touches React, so each group is a
// function of its input and the "what should this row say" decisions sit together rather than
// inside a 150-line `useMemo`.

import type { ConnectionSummary, DatabaseSchema, Table } from "@perch/protocol";
import type { LucideIcon } from "lucide-react";
import { DatabaseIcon, EyeIcon, FileIcon, Table2Icon } from "lucide-react";
import { plural } from "../../lib/format";
import type { Buffer } from "../types";

/** An entry the app wants in the palette. Same shape the built-in actions use. */
export type PaletteAction = {
  label: string;
  hint?: string;
  shortcut?: string;
  icon?: LucideIcon;
  onSelect: () => void;
};

export type PaletteItem = PaletteAction & { value: string };
export type PaletteGroup = { value: string; items: PaletteItem[] };

/** Every table and view in the loaded schema, qualified by the schema it lives in. */
export function tableItems(
  schema: DatabaseSchema | undefined,
  onPick: (table: Table) => void,
): PaletteItem[] {
  return (schema?.schemas ?? []).flatMap((group) =>
    group.tables.map((table) => ({
      value: `table:${group.name}.${table.name}`,
      label: table.name,
      hint: `${group.name} · ${plural(table.columns.length, "column")}`,
      icon: table.kind === "view" ? EyeIcon : Table2Icon,
      onSelect: () => onPick(table),
    })),
  );
}

/** The open tabs, by id rather than by path, so a scratch is reachable too. */
export function fileItems(buffers: readonly Buffer[], onPick: (id: string) => void): PaletteItem[] {
  return buffers.map((file) => ({
    value: `file:${file.id}`,
    label: file.name,
    hint: file.dirty ? "unsaved" : undefined,
    icon: FileIcon,
    onSelect: () => onPick(file.id),
  }));
}

export function connectionItems(
  connections: readonly ConnectionSummary[] | undefined,
  onPick: (id: string) => void,
): PaletteItem[] {
  return (connections ?? []).map((connection) => ({
    value: `connection:${connection.id}`,
    label: connection.name,
    hint: `${connection.host}:${connection.port}`,
    icon: DatabaseIcon,
    onSelect: () => onPick(connection.id),
  }));
}

/** Free from the contract: switching database without reaching for the picker. */
export function databaseItems(
  databases: readonly string[] | undefined,
  current: string | null,
  onPick: (name: string) => void,
): PaletteItem[] {
  return (databases ?? [])
    .filter((name) => name !== current)
    .map((name) => ({
      value: `database:${name}`,
      label: name,
      hint: "switch database",
      icon: DatabaseIcon,
      onSelect: () => onPick(name),
    }));
}
