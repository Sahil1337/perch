import type { Column, DatabaseSchema, ForeignKey, Table } from "@perch/protocol";
import { CARD_W, COLLAPSE_AT, cardHeight } from "./geometry";

export type Node = {
  key: string;
  table: Table;
  w: number;
  h: number;
  /** The columns the card shows, in order; wires anchor to indexes in this list. */
  rows: Column[];
  /** The last row, when the card is showing fewer or more columns than it has to. */
  footer: "more" | "fewer" | null;
  /** Columns the card is not showing. */
  hidden: number;
};

export type Edge = {
  id: string;
  fk: ForeignKey;
  /** The referencing (FK) table and row index, or -1 when the column is not in the list. */
  from: string;
  fromColumn: number;
  /** The referenced (PK) table and row index. */
  to: string;
  toColumn: number;
};

export type Graph = { nodes: Node[]; edges: Edge[] };

export const NO_TABLES: ReadonlySet<string> = new Set();

export function tableKey(table: Pick<Table, "schema" | "name">): string {
  return `${table.schema}.${table.name}`;
}

/** The columns that take part in a relation: the primary key and every foreign-key column. */
function keyColumns(table: Table): Set<string> {
  const keys = new Set<string>();
  for (const column of table.columns) if (column.pk) keys.add(column.name);
  for (const fk of table.foreignKeys) for (const column of fk.columns) keys.add(column);
  return keys;
}

/**
 * One card. In keys-only mode a card shows its key columns and a row counting the rest, unless it
 * has been opened by hand (`expanded`), in which case it shows everything and a row to close it.
 */
export function buildNode(table: Table, keysOnly: boolean, expanded: ReadonlySet<string>): Node {
  const key = tableKey(table);
  const keys = keysOnly ? keyColumns(table) : null;
  const open = keys === null || expanded.has(key);
  const rows = open ? table.columns : table.columns.filter((column) => keys.has(column.name));
  const hidden = table.columns.length - rows.length;
  const footer: Node["footer"] =
    keys === null ? null : hidden > 0 ? "more" : table.columns.length > keys.size ? "fewer" : null;
  return { key, table, w: CARD_W, h: cardHeight(rows.length, footer !== null), rows, footer, hidden };
}

/** Whether any table is wide enough that the view should open in keys-only mode. */
export function isWide(schema: DatabaseSchema): boolean {
  return schema.schemas.some((entry) =>
    entry.tables.some((table) => table.columns.length > COLLAPSE_AT),
  );
}

export function buildGraph(
  schema: DatabaseSchema,
  keysOnly: boolean,
  expanded: ReadonlySet<string>,
): Graph {
  const nodes: Node[] = [];
  const byKey = new Map<string, Node>();
  for (const entry of schema.schemas) {
    for (const table of entry.tables) {
      const node = buildNode(table, keysOnly, expanded);
      nodes.push(node);
      byKey.set(node.key, node);
    }
  }

  const edges: Edge[] = [];
  for (const node of nodes) {
    for (const fk of node.table.foreignKeys) {
      const to = byKey.get(`${fk.refSchema}.${fk.refTable}`);
      // A reference into a schema the tree does not show has nowhere to land.
      if (!to) continue;
      edges.push({
        id: `${node.key}:${fk.name}`,
        fk,
        from: node.key,
        fromColumn: node.rows.findIndex((column) => column.name === fk.columns[0]),
        to: to.key,
        toColumn: to.rows.findIndex((column) => column.name === fk.refColumns[0]),
      });
    }
  }

  return { nodes, edges };
}
