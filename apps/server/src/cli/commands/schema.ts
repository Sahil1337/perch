// `perch schema <conn> [--database db] [--table schema.table]`

import type { DatabaseSchema, Table } from "@perch/protocol";
import {
  bold,
  defineCommand,
  die,
  dim,
  printJson,
  requireConnection,
  withDriver,
} from "../util/index.js";

const SCHEMA_HELP = `usage: perch schema <conn> [--database <db>] [--table <schema.table>] [--json]

With no --table, prints a tree of schemas -> tables/views. With --table, prints that table's columns.
`;

function findTable(schema: DatabaseSchema, spec: string): Table {
  const dot = spec.indexOf(".");
  const schemaName = dot === -1 ? undefined : spec.slice(0, dot);
  const tableName = dot === -1 ? spec : spec.slice(dot + 1);
  const matches = schema.schemas
    .filter((s) => schemaName === undefined || s.name === schemaName)
    .flatMap((s) => s.tables.filter((t) => t.name === tableName));
  if (matches.length === 0) die(`table not found: ${spec}`);
  if (matches.length > 1) {
    const qualified = schema.schemas
      .flatMap((s) =>
        s.tables.filter((t) => t.name === tableName).map((t) => `${s.name}.${t.name}`),
      )
      .join(", ");
    die(`ambiguous table "${tableName}" — qualify with a schema: ${qualified}`);
  }
  return matches[0]!;
}

const KIND_MARK: Record<Table["kind"], string> = {
  table: "",
  view: " (view)",
  materialized_view: " (matview)",
};

function printTree(schema: DatabaseSchema): void {
  for (const s of schema.schemas) {
    console.log(bold(s.name));
    for (const t of s.tables) {
      const est = t.rowEstimate !== undefined ? dim(`  ~${Math.round(t.rowEstimate)} rows`) : "";
      console.log(`  ${t.name}${dim(KIND_MARK[t.kind])}${est}`);
    }
    if (s.tables.length === 0) console.log(dim("  (empty)"));
  }
}

function printColumns(table: Table): void {
  console.log(`${bold(`${table.schema}.${table.name}`)}${dim(KIND_MARK[table.kind])}`);
  const nameW = Math.max(4, ...table.columns.map((c) => c.name.length));
  const typeW = Math.max(4, ...table.columns.map((c) => c.type.length));
  for (const c of table.columns) {
    const flags = [c.pk ? "pk" : "", c.nullable ? "" : "not null"].filter(Boolean).join(" ");
    const def = c.default ? dim(` default ${c.default}`) : "";
    console.log(`  ${c.name.padEnd(nameW)}  ${c.type.padEnd(typeW)}  ${dim(flags)}${def}`);
  }
}

export const cmdSchema = defineCommand(
  {
    usage: SCHEMA_HELP,
    positionals: ["conn"],
    options: { database: { type: "string" }, table: { type: "string" } },
  },
  async ({ values, positionals, json }) => {
    const conn = await requireConnection(positionals[0]!);
    const schema = await withDriver(conn, (d) => d.getSchema(values.database));

    if (values.table) {
      const table = findTable(schema, values.table);
      if (json) printJson(table);
      else printColumns(table);
      return;
    }
    if (json) printJson(schema);
    else printTree(schema);
  },
);
