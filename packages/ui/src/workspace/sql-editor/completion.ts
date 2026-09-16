// The contract's schema, translated into what `@codemirror/lang-sql` wants for completion.

import type { Completion } from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";
import type { DatabaseSchema, Dialect } from "@perch/protocol";

/**
 * The contract's schema, as completion data. `{ "<schema>.<table>": columns }` is the shape `sql()`
 * wants for a qualified namespace. The driver type is the `detail` line, and primary keys get a
 * marker and a distinct icon so the join column is visible at a glance.
 */
export function completionNamespace(schema: DatabaseSchema | undefined): SQLNamespace | undefined {
  if (!schema) return undefined;
  const namespace: Record<string, readonly Completion[]> = {};
  for (const entry of schema.schemas) {
    for (const table of entry.tables) {
      namespace[`${entry.name}.${table.name}`] = table.columns.map((column) => ({
        detail: column.pk ? `${column.type} · pk` : column.type,
        label: column.name,
        type: column.pk ? "constant" : "property",
      }));
    }
  }
  return namespace as SQLNamespace;
}

/** The schema whose tables can be typed unqualified: `public` on PostgreSQL, the database on MySQL. */
export function defaultSchemaName(
  schema: DatabaseSchema | undefined,
  dialect: Dialect,
): string | undefined {
  if (!schema) return undefined;
  const names = schema.schemas.map((entry) => entry.name);
  const preferred = dialect === "mysql" ? schema.database : "public";
  return names.includes(preferred) ? preferred : names[0];
}
