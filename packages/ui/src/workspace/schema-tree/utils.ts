import type { DatabaseSchema } from "@perch/protocol";
import { EyeIcon, LayersIcon, Table2Icon } from "lucide-react";

/** Pixels. Indentation is the one row value that depends on data, so it is the one inline value. */
export const INDENT_BASE = 8;
export const INDENT_STEP = 12;

export const SKELETON_ROWS = 6;

export const KIND_ICON = {
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
export function needsSchemaLevel(schema: DatabaseSchema | undefined): boolean {
  return (schema?.schemas.length ?? 0) > 1;
}

/**
 * Row indentation: the only value here Tailwind cannot hold, because it is a function of the row's
 * depth. It is fed to a `--tree-indent` custom property at each call site so the padding stays a
 * utility class and only the number is inline.
 */
export function indent(depth: number): string {
  return `${INDENT_BASE + depth * INDENT_STEP}px`;
}

export function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
