import type { DatabaseSchema } from "@perch/protocol";
import { EyeIcon, LayersIcon, Table2Icon } from "lucide-react";

export { INDENT_BASE, INDENT_STEP, indent, toggle } from "../../lib/tree";

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
