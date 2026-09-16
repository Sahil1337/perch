// Layout is automatic and then yours: cards are layered so a referenced table sits left of the
// tables that point at it, ordered within a layer to keep wires from crossing, and any card can be
// dragged after that. Tables with no keys in either direction are set out in a grid underneath, so
// they are on the picture without cluttering the part of it that says something.

import { CARD_W, GAP_X, GAP_Y, ORPHAN_COLS_MIN, ORPHAN_GAP, type Point } from "./geometry";
import type { Edge, Node } from "./graph";

/**
 * Layered layout: referenced tables to the left of the tables that reference them, each layer
 * ordered by the average position of its neighbours so wires cross as little as a single sweep
 * each way can manage. Cycles are broken at the back edges a depth-first walk finds; those keys
 * still get wires, they just do not decide the layering.
 */
export function autoLayout(nodes: Node[], edges: Edge[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  if (nodes.length === 0) return positions;

  const degree = new Map<string, number>();
  const children = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    (children.get(edge.to) ?? children.set(edge.to, new Set()).get(edge.to))!.add(edge.from);
    (parents.get(edge.from) ?? parents.set(edge.from, new Set()).get(edge.from))!.add(edge.to);
  }

  const connected = nodes.filter((node) => (degree.get(node.key) ?? 0) > 0);
  const orphans = nodes.filter((node) => (degree.get(node.key) ?? 0) === 0);

  /* Topological order with back edges dropped. */
  const state = new Map<string, "open" | "done">();
  const order: string[] = [];
  const dropped = new Set<string>();
  const visit = (key: string): void => {
    state.set(key, "open");
    for (const child of children.get(key) ?? []) {
      const seen = state.get(child);
      if (seen === "open") dropped.add(`${key}>${child}`);
      else if (seen === undefined) visit(child);
    }
    state.set(key, "done");
    order.push(key);
  };
  for (const node of connected) if (!state.has(node.key)) visit(node.key);
  order.reverse();

  const layerOf = new Map<string, number>();
  for (const key of order) layerOf.set(key, 0);
  for (const key of order) {
    const base = layerOf.get(key) ?? 0;
    for (const child of children.get(key) ?? []) {
      if (dropped.has(`${key}>${child}`)) continue;
      layerOf.set(child, Math.max(layerOf.get(child) ?? 0, base + 1));
    }
  }

  const layerCount = Math.max(0, ...[...layerOf.values()]) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const node of connected) layers[layerOf.get(node.key) ?? 0]!.push(node.key);
  for (const layer of layers) layer.sort();

  /* Barycenter sweeps: left to right by parents, then right to left by children. */
  const rank = new Map<string, number>();
  const sweep = (index: number, neighbours: Map<string, Set<string>>): void => {
    const layer = layers[index]!;
    const scored = layer.map((key, position) => {
      const near = [...(neighbours.get(key) ?? [])]
        .map((other) => rank.get(other))
        .filter((value): value is number => value !== undefined);
      const score = near.length === 0 ? position : near.reduce((a, b) => a + b, 0) / near.length;
      return { key, score, position };
    });
    scored.sort((a, b) => a.score - b.score || a.position - b.position);
    layers[index] = scored.map((entry) => entry.key);
    layers[index]!.forEach((key, position) => rank.set(key, position));
  };
  layers[0]?.forEach((key, position) => rank.set(key, position));
  for (let index = 1; index < layers.length; index += 1) sweep(index, parents);
  for (let index = layers.length - 2; index >= 0; index -= 1) sweep(index, children);

  /* Coordinates: each layer a column, centred on the tallest. */
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const heights = layers.map((layer) =>
    layer.reduce((total, key) => total + (nodeByKey.get(key)?.h ?? 0), 0) +
    Math.max(0, layer.length - 1) * GAP_Y,
  );
  const tallest = Math.max(0, ...heights);
  layers.forEach((layer, index) => {
    let y = (tallest - heights[index]!) / 2;
    for (const key of layer) {
      positions.set(key, { x: index * (CARD_W + GAP_X), y });
      y += (nodeByKey.get(key)?.h ?? 0) + GAP_Y;
    }
  });

  /* The unconnected grid, under the graph, as wide as the graph or a few columns, whichever is more. */
  if (orphans.length > 0) {
    const graphWidth = layers.length * (CARD_W + GAP_X) - GAP_X;
    const columns = Math.max(
      ORPHAN_COLS_MIN,
      layers.length === 0
        ? Math.min(4, Math.ceil(Math.sqrt(orphans.length)))
        : Math.floor((graphWidth + GAP_X) / (CARD_W + GAP_X)),
    );
    let y = layers.length === 0 ? 0 : tallest + ORPHAN_GAP;
    for (let start = 0; start < orphans.length; start += columns) {
      const row = orphans.slice(start, start + columns);
      row.forEach((node, index) => positions.set(node.key, { x: index * (CARD_W + GAP_X), y }));
      y += Math.max(...row.map((node) => node.h)) + GAP_Y;
    }
  }

  return positions;
}
