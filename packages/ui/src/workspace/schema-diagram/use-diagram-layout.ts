"use client";

import type { DatabaseSchema } from "@perch/protocol";
import * as React from "react";
import { CARD_W, GAP_X, GAP_Y, type Point, type Rect } from "./geometry";
import { buildGraph, buildNode, type Graph, isWide, type Node, NO_TABLES } from "./graph";
import { autoLayout } from "./layout";
import { clearPositions, readPositions, storageKey, writePositions } from "./storage";

const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };

export type DiagramLayout = {
  readonly graph: Graph;
  readonly nodeByKey: ReadonlyMap<string, Node>;
  readonly positions: ReadonlyMap<string, Point>;
  /** The box the cards occupy, with room for the wires that loop outside them. */
  readonly bounds: Rect;
  readonly keysOnly: boolean;
  readonly setKeysOnly: (next: boolean) => void;
  readonly toggleCard: (key: string) => void;
  readonly resetLayout: (refit: () => void) => void;
  readonly moveCard: (key: string, at: Point) => void;
  /** Remembers where the cards are now, so the next visit opens on the same picture. */
  readonly savePositions: () => void;
};

/** The auto layout, with whatever this database's cards were dragged to last time put back. */
function initialPositions(graph: Graph, storeKey: string | null): Map<string, Point> {
  const positions = autoLayout(graph.nodes, graph.edges);
  const stored = readPositions(storeKey);
  if (stored) for (const [key, at] of stored) if (positions.has(key)) positions.set(key, at);
  return positions;
}

/** The cards: which columns they show, where they are, and everything that moves them. */
export function useDiagramLayout({
  connectionId,
  data,
  database,
}: {
  connectionId: string | null;
  data: DatabaseSchema | undefined;
  database: string | null;
}): DiagramLayout {
  // Keys-only is the default for a wide schema; the toolbar toggle overrides it either way.
  const [keysOnlyChoice, setKeysOnlyChoice] = React.useState<boolean | null>(null);
  const keysOnly = keysOnlyChoice ?? (data ? isWide(data) : false);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(NO_TABLES);

  // Two graphs: the one on screen, and the one the layout is made from, which ignores what has
  // been opened by hand so opening one card never reflows every other card.
  const graph = React.useMemo(
    () => (data ? buildGraph(data, keysOnly, expanded) : EMPTY_GRAPH),
    [data, expanded, keysOnly],
  );
  const baseGraph = React.useMemo(
    () => (data ? buildGraph(data, keysOnly, NO_TABLES) : EMPTY_GRAPH),
    [data, keysOnly],
  );
  const nodeByKey = React.useMemo(
    () => new Map(graph.nodes.map((node) => [node.key, node])),
    [graph],
  );

  // A fresh schema, another database or the other mode re-lays everything out; a drag is worth
  // keeping only against the picture it was made on, so the layout carries the graph it was made
  // for. The storage key changes with the same things, and the cards come back where they were.
  const storeKey = storageKey(connectionId, database, keysOnly);
  const [layout, setLayout] = React.useState<{ graph: Graph; positions: Map<string, Point> }>(
    () => ({ graph: baseGraph, positions: initialPositions(baseGraph, storeKey) }),
  );
  if (layout.graph !== baseGraph) {
    setLayout({ graph: baseGraph, positions: initialPositions(baseGraph, storeKey) });
  }
  const positions = layout.positions;

  const bounds = React.useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of graph.nodes) {
      const at = positions.get(node.key);
      if (!at) continue;
      minX = Math.min(minX, at.x);
      minY = Math.min(minY, at.y);
      maxX = Math.max(maxX, at.x + node.w);
      maxY = Math.max(maxY, at.y + node.h);
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    // Room for wires that loop outside the cards on the right.
    return {
      x: minX - GAP_X,
      y: minY - GAP_Y,
      w: maxX - minX + GAP_X * 2,
      h: maxY - minY + GAP_Y * 2,
    };
  }, [graph.nodes, positions]);

  const setKeysOnly = (next: boolean): void => {
    setKeysOnlyChoice(next);
    setExpanded(NO_TABLES);
  };

  /**
   * Opens or closes one card. The cards under it in the same column move by the difference, so
   * opening a wide table pushes its neighbours down rather than over them; nothing else moves.
   */
  const toggleCard = (key: string): void => {
    const node = nodeByKey.get(key);
    const at = positions.get(key);
    if (!node || !at) return;
    const nextExpanded = new Set(expanded);
    if (!nextExpanded.delete(key)) nextExpanded.add(key);
    const delta = buildNode(node.table, keysOnly, nextExpanded).h - node.h;
    setExpanded(nextExpanded);
    if (delta === 0) return;
    const next = new Map(positions);
    for (const [other, otherAt] of positions) {
      if (other === key || otherAt.y <= at.y || Math.abs(otherAt.x - at.x) >= CARD_W) continue;
      next.set(other, { x: otherAt.x, y: otherAt.y + delta });
    }
    // Not written to storage: a card opened to look at something is not a layout decision.
    setLayout({ graph: baseGraph, positions: next });
  };

  /** `refit` is the caller's, because what the new layout should be fitted into is the view's. */
  const resetLayout = (refit: () => void): void => {
    clearPositions(storeKey);
    setExpanded(NO_TABLES);
    setLayout({ graph: baseGraph, positions: autoLayout(baseGraph.nodes, baseGraph.edges) });
    // Positions land on the next render; fit reads them then.
    window.requestAnimationFrame(refit);
  };

  const moveCard = React.useCallback((key: string, at: Point): void => {
    setLayout((previous) => ({
      ...previous,
      positions: new Map(previous.positions).set(key, at),
    }));
  }, []);

  const savePositions = (): void => writePositions(storeKey, positions);

  return {
    bounds,
    graph,
    keysOnly,
    moveCard,
    nodeByKey,
    positions,
    resetLayout,
    savePositions,
    setKeysOnly,
    toggleCard,
  };
}
