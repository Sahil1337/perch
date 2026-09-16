import type { DatabaseSchema, ForeignKey, Table } from "@perch/protocol";
import { CARD_W, cardHeight } from "./geometry";

export type Node = {
  key: string;
  table: Table;
  w: number;
  h: number;
};

export type Edge = {
  id: string;
  fk: ForeignKey;
  /** The referencing (FK) table and column index, or -1 when the column is not in the list. */
  from: string;
  fromColumn: number;
  /** The referenced (PK) table and column index. */
  to: string;
  toColumn: number;
};

export type Graph = { nodes: Node[]; edges: Edge[] };

export function tableKey(table: Pick<Table, "schema" | "name">): string {
  return `${table.schema}.${table.name}`;
}

export function buildGraph(schema: DatabaseSchema): Graph {
  const nodes: Node[] = [];
  const byKey = new Map<string, Node>();
  for (const entry of schema.schemas) {
    for (const table of entry.tables) {
      const node = { key: tableKey(table), table, w: CARD_W, h: cardHeight(table) };
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
        fromColumn: node.table.columns.findIndex((column) => column.name === fk.columns[0]),
        to: to.key,
        toColumn: to.table.columns.findIndex((column) => column.name === fk.refColumns[0]),
      });
    }
  }

  return { nodes, edges };
}
