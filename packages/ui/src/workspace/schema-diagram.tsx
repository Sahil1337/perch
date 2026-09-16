"use client";

// The relationship view: every table as a card of typed columns, every foreign key as a wire from
// the column that holds it to the key it points at. Drawn here rather than handed to a diagram
// library because the two things this view exists for — a wire that starts at *this* column and
// a pulse that travels along it — are exactly what a text-to-SVG renderer cannot give back.
//
// Layout is automatic and then yours: cards are layered so a referenced table sits left of the
// tables that point at it, ordered within a layer to keep wires from crossing, and any card can be
// dragged after that. Tables with no keys in either direction are set out in a grid underneath, so
// they are on the picture without cluttering the part of it that says something.
//
// The pulse runs FK → PK, the direction a lookup goes. It runs on every wire, all the time, at a
// pace slow enough to read as travel; selecting a table dims everything that does not touch it.

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { Column, DatabaseSchema, ForeignKey, Table } from "@perch/protocol";
import {
  EyeIcon,
  KeyRoundIcon,
  LayersIcon,
  Link2Icon,
  RotateCcwIcon,
  ScanIcon,
  Table2Icon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { DialogBackdrop, DialogPortal } from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useWorkspace } from "./context";
import { asyncData } from "./types";

/* ---------------------------------------------------------------- opening */

export const SCHEMA_DIAGRAM_EVENT = "perch:visualise";

export type SchemaDiagramEventDetail = {
  /** `schema.table` to select and centre on when the view opens. */
  focus?: string;
};

/**
 * Opens the relationship view from anywhere — the sidebar button, the palette — without the caller
 * owning the dialog. `<SchemaDiagramDialog>` is mounted once in the shell and listens.
 */
export function requestSchemaDiagram(focus?: string): void {
  window.dispatchEvent(
    new CustomEvent<SchemaDiagramEventDetail>(SCHEMA_DIAGRAM_EVENT, { detail: { focus } }),
  );
}

export function tableKey(table: Pick<Table, "schema" | "name">): string {
  return `${table.schema}.${table.name}`;
}

/* --------------------------------------------------------------- geometry */

// Every card is the same width and its height is a function of its column count, so the layout
// needs no measurement pass: the classes on the card (`w-64`, `h-8`, `h-6`, `py-1`) are these
// numbers spelled as utilities, and the wires are drawn from the numbers.
const CARD_W = 256;
const HEADER_H = 32;
const ROW_H = 24;
const BODY_PAD = 4;

/** Horizontal room between layers, enough for a wire to bend without looking like a step. */
const GAP_X = 128;
const GAP_Y = 40;
/** Between the connected graph and the grid of unconnected tables beneath it. */
const ORPHAN_GAP = 96;
const ORPHAN_COLS_MIN = 3;

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;
/** Padding kept around the graph when fitting it to the viewport. */
const FIT_PAD = 48;
/** Pointer travel under which a press-and-release is a click, not a drag. */
const CLICK_SLOP = 3;

/** How long one pulse takes to cross a wire, in seconds. */
const TRAVEL_S = 2.4;
/** Fraction of a wire the pulse covers. */
const PULSE_LEN = 0.14;

type Point = { x: number; y: number };

type Node = {
  key: string;
  table: Table;
  w: number;
  h: number;
};

type Edge = {
  id: string;
  fk: ForeignKey;
  /** The referencing (FK) table and column index, or -1 when the column is not in the list. */
  from: string;
  fromColumn: number;
  /** The referenced (PK) table and column index. */
  to: string;
  toColumn: number;
};

function cardHeight(table: Table): number {
  return HEADER_H + BODY_PAD * 2 + Math.max(1, table.columns.length) * ROW_H;
}

/** Vertical centre of a column row inside its card; the header for a column that is not listed. */
function rowCentre(index: number): number {
  return index < 0 ? HEADER_H / 2 : HEADER_H + BODY_PAD + index * ROW_H + ROW_H / 2;
}

function buildGraph(schema: DatabaseSchema): { nodes: Node[]; edges: Edge[] } {
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

/**
 * Layered layout: referenced tables to the left of the tables that reference them, each layer
 * ordered by the average position of its neighbours so wires cross as little as a single sweep
 * each way can manage. Cycles are broken at the back edges a depth-first walk finds; those keys
 * still get wires, they just do not decide the layering.
 */
function autoLayout(nodes: Node[], edges: Edge[]): Map<string, Point> {
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

type Wire = {
  edge: Edge;
  d: string;
  /** Where the wire leaves the referencing card, and which way it heads (+1 right, -1 left). */
  start: Point;
  startDir: 1 | -1;
  /** Where it meets the referenced card. */
  end: Point;
  endDir: 1 | -1;
};

function routeWire(
  edge: Edge,
  from: Node,
  fromAt: Point,
  to: Node,
  toAt: Point,
): Wire {
  const y1 = fromAt.y + rowCentre(edge.fromColumn);
  const y2 = toAt.y + rowCentre(edge.toColumn);
  const fromMid = fromAt.x + from.w / 2;

  let x1: number;
  let x2: number;
  let startDir: 1 | -1;
  let endDir: 1 | -1;
  if (toAt.x >= fromMid) {
    // Target to the right: out of our right edge, into its left.
    x1 = fromAt.x + from.w;
    x2 = toAt.x;
    startDir = 1;
    endDir = -1;
  } else if (toAt.x + to.w <= fromMid) {
    x1 = fromAt.x;
    x2 = toAt.x + to.w;
    startDir = -1;
    endDir = 1;
  } else {
    // Overlapping columns, or a table pointing at itself: loop out of both right edges.
    x1 = fromAt.x + from.w;
    x2 = toAt.x + to.w;
    startDir = 1;
    endDir = 1;
  }

  const same = startDir === endDir;
  const reach = same
    ? Math.max(56, Math.min(120, Math.abs(y2 - y1) / 2))
    : Math.max(40, Math.min(160, Math.abs(x2 - x1) / 2));
  const c1x = x1 + startDir * reach;
  const c2x = x2 + endDir * reach;
  const d = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;

  return { edge, d, start: { x: x1, y: y1 }, startDir, end: { x: x2, y: y2 }, endDir };
}

/* ----------------------------------------------------------------- dialog */

/**
 * The relationship view, mounted once in the shell. Opens on `requestSchemaDiagram()`, over the
 * whole window: a diagram is the one thing in the app that wants every pixel it can get.
 */
export function SchemaDiagramDialog(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [focus, setFocus] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<SchemaDiagramEventDetail>).detail;
      setFocus(detail?.focus);
      setOpen(true);
    };
    window.addEventListener(SCHEMA_DIAGRAM_EVENT, listener);
    return () => window.removeEventListener(SCHEMA_DIAGRAM_EVENT, listener);
  }, []);

  return (
    <DialogPrimitive.Root onOpenChange={setOpen} open={open}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-3 z-50 flex min-h-0 min-w-0 origin-center flex-col outline-none",
            "transition-all duration-200 ease-in-out",
            "data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
          )}
          data-slot="dialog-popup"
        >
          {open && <SchemaDiagram focus={focus} />}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

/* ---------------------------------------------------------------- diagram */

type Drag =
  | { kind: "pan"; pointerId: number; origin: Point; pan: Point; moved: boolean }
  | { kind: "card"; pointerId: number; key: string; origin: Point; at: Point; moved: boolean };

function SchemaDiagram({ focus }: { focus?: string }): React.ReactElement {
  const { schema, database } = useWorkspace();
  const data = asyncData(schema);
  const reduced = useReducedMotion();

  const graph = React.useMemo(() => (data ? buildGraph(data) : { nodes: [], edges: [] }), [data]);
  const nodeByKey = React.useMemo(
    () => new Map(graph.nodes.map((node) => [node.key, node])),
    [graph],
  );

  const [positions, setPositions] = React.useState<Map<string, Point>>(() =>
    autoLayout(graph.nodes, graph.edges),
  );
  // A fresh schema (a refresh, another database) re-lays everything out; a drag is worth keeping
  // only against the picture it was made on.
  React.useEffect(() => setPositions(autoLayout(graph.nodes, graph.edges)), [graph]);

  const [selected, setSelected] = React.useState<string | null>(focus ?? null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [view, setView] = React.useState<{ pan: Point; zoom: number }>({
    pan: { x: 0, y: 0 },
    zoom: 1,
  });
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);

  const wires = React.useMemo(() => {
    const result: Wire[] = [];
    for (const edge of graph.edges) {
      const from = nodeByKey.get(edge.from);
      const to = nodeByKey.get(edge.to);
      const fromAt = positions.get(edge.from);
      const toAt = positions.get(edge.to);
      if (!from || !to || !fromAt || !toAt) continue;
      result.push(routeWire(edge, from, fromAt, to, toAt));
    }
    return result;
  }, [graph.edges, nodeByKey, positions]);

  /** The table the picture is about right now: what is selected, else what is under the pointer. */
  const active = selected ?? hovered;
  const related = React.useMemo(() => {
    if (!active) return null;
    const set = new Set<string>([active]);
    for (const edge of graph.edges) {
      if (edge.from === active) set.add(edge.to);
      if (edge.to === active) set.add(edge.from);
    }
    return set;
  }, [active, graph.edges]);

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
    return { x: minX - GAP_X, y: minY - GAP_Y, w: maxX - minX + GAP_X * 2, h: maxY - minY + GAP_Y * 2 };
  }, [graph.nodes, positions]);

  const fit = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || bounds.w === 0) return;
    const { width, height } = viewport.getBoundingClientRect();
    const zoom = Math.max(
      ZOOM_MIN,
      Math.min(1, (width - FIT_PAD * 2) / bounds.w, (height - FIT_PAD * 2) / bounds.h),
    );
    setView({
      zoom,
      pan: {
        x: (width - bounds.w * zoom) / 2 - bounds.x * zoom,
        y: (height - bounds.h * zoom) / 2 - bounds.y * zoom,
      },
    });
  }, [bounds]);

  const centreOn = React.useCallback(
    (key: string) => {
      const viewport = viewportRef.current;
      const node = nodeByKey.get(key);
      const at = positions.get(key);
      if (!viewport || !node || !at) return;
      const { width, height } = viewport.getBoundingClientRect();
      setView({
        zoom: 1,
        pan: { x: width / 2 - (at.x + node.w / 2), y: height / 2 - (at.y + node.h / 2) },
      });
    },
    [nodeByKey, positions],
  );

  // First paint: the whole graph, or the table the view was opened for.
  const fitOnce = React.useRef(false);
  React.useLayoutEffect(() => {
    if (fitOnce.current || graph.nodes.length === 0) return;
    fitOnce.current = true;
    if (focus && nodeByKey.has(focus)) centreOn(focus);
    else fit();
  }, [centreOn, fit, focus, graph.nodes.length, nodeByKey]);

  const zoomBy = React.useCallback((factor: number, about?: Point) => {
    setView((previous) => {
      const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, previous.zoom * factor));
      const viewport = viewportRef.current?.getBoundingClientRect();
      const pivot = about ?? { x: (viewport?.width ?? 0) / 2, y: (viewport?.height ?? 0) / 2 };
      const scale = zoom / previous.zoom;
      return {
        zoom,
        pan: {
          x: pivot.x - (pivot.x - previous.pan.x) * scale,
          y: pivot.y - (pivot.y - previous.pan.y) * scale,
        },
      };
    });
  }, []);

  // A native listener, because React registers wheel as passive and the page must not scroll
  // while the pointer is over the canvas. Pinch (ctrl+wheel) zooms about the pointer; a plain
  // scroll pans, which is what a trackpad expects.
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        zoomBy(Math.exp(-event.deltaY * 0.01), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else {
        setView((previous) => ({
          ...previous,
          pan: { x: previous.pan.x - event.deltaX, y: previous.pan.y - event.deltaY },
        }));
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  /* Pointer handling. The viewport pans; a card drags; a press without travel is a click. */
  const onViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      kind: "pan",
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      pan: view.pan,
      moved: false,
    });
  };

  const onCardPointerDown = (event: React.PointerEvent<HTMLDivElement>, key: string): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const at = positions.get(key);
    if (!at) return;
    viewportRef.current?.setPointerCapture(event.pointerId);
    setDrag({
      kind: "card",
      pointerId: event.pointerId,
      key,
      origin: { x: event.clientX, y: event.clientY },
      at,
      moved: false,
    });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.origin.x;
    const dy = event.clientY - drag.origin.y;
    const moved = drag.moved || Math.hypot(dx, dy) > CLICK_SLOP;
    if (!moved) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    if (drag.kind === "pan") {
      setView((previous) => ({ ...previous, pan: { x: drag.pan.x + dx, y: drag.pan.y + dy } }));
    } else {
      const next = { x: drag.at.x + dx / view.zoom, y: drag.at.y + dy / view.zoom };
      setPositions((previous) => new Map(previous).set(drag.key, next));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) {
      // A click: on a card selects it (again to clear); on the canvas clears.
      setSelected((previous) => (drag.kind === "card" && previous !== drag.key ? drag.key : null));
    }
    setDrag(null);
  };

  const tableCount = graph.nodes.length;
  const relationCount = graph.edges.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg/5">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="font-medium text-sm leading-none">
            Relationships
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 truncate text-muted-foreground text-xs">
            {database ?? "No database"}
            {data && (
              <>
                {" · "}
                {tableCount} {tableCount === 1 ? "table" : "tables"}
                {" · "}
                {relationCount} {relationCount === 1 ? "relation" : "relations"}
              </>
            )}
          </DialogPrimitive.Description>
        </div>

        <div className="flex items-center gap-1">
          <ToolButton label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <ZoomOutIcon />
          </ToolButton>
          <span className="w-10 text-center font-mono text-muted-foreground text-xs tabular-nums">
            {Math.round(view.zoom * 100)}%
          </span>
          <ToolButton label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            <ZoomInIcon />
          </ToolButton>
          <ToolButton label="Fit to view" onClick={fit}>
            <ScanIcon />
          </ToolButton>
          <ToolButton
            label="Reset layout"
            onClick={() => {
              setPositions(autoLayout(graph.nodes, graph.edges));
              // Positions land on the next render; fit reads them then.
              window.requestAnimationFrame(fit);
            }}
          >
            <RotateCcwIcon />
          </ToolButton>
          <div aria-hidden className="mx-1 h-4 w-px bg-border" />
          <DialogPrimitive.Close
            aria-label="Close"
            render={<Button size="icon-sm" variant="ghost" />}
          >
            <XIcon />
          </DialogPrimitive.Close>
        </div>
      </header>

      <div
        className={cn(
          "relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-background",
          drag?.kind === "pan" ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerCancel={onPointerUp}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={viewportRef}
      >
        {data === undefined ? (
          <Notice>{schema.status === "error" ? schema.error : "Loading schema…"}</Notice>
        ) : tableCount === 0 ? (
          <Notice>No tables in this database.</Notice>
        ) : (
          <div
            className="absolute top-0 left-0 origin-top-left translate-x-(--pan-x) translate-y-(--pan-y) scale-(--zoom)"
            style={
              {
                "--pan-x": `${view.pan.x}px`,
                "--pan-y": `${view.pan.y}px`,
                "--zoom": view.zoom,
              } as React.CSSProperties
            }
          >
            <svg
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 overflow-visible"
              height={1}
              width={1}
            >
              {wires.map((wire, index) => (
                <WirePath
                  animate={!reduced}
                  dim={related !== null && !(related.has(wire.edge.from) && related.has(wire.edge.to))}
                  index={index}
                  key={wire.edge.id}
                  lit={related !== null && (wire.edge.from === active || wire.edge.to === active)}
                  wire={wire}
                />
              ))}
            </svg>

            {graph.nodes.map((node) => {
              const at = positions.get(node.key);
              if (!at) return null;
              return (
                <TableCard
                  at={at}
                  dim={related !== null && !related.has(node.key)}
                  dragging={drag?.kind === "card" && drag.key === node.key}
                  edges={graph.edges}
                  key={node.key}
                  node={node}
                  onHover={setHovered}
                  onPointerDown={onCardPointerDown}
                  selected={selected === node.key}
                  showSchema={(data?.schemas.length ?? 0) > 1}
                />
              );
            })}
          </div>
        )}

        {data !== undefined && tableCount > 0 && <Legend noRelations={relationCount === 0} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ wires */

function WirePath({
  animate,
  dim,
  index,
  lit,
  wire,
}: {
  animate: boolean;
  dim: boolean;
  index: number;
  lit: boolean;
  wire: Wire;
}): React.ReactElement {
  const { edge, d, start, startDir, end, endDir } = wire;
  const label = `${edge.from}.${edge.fk.columns.join(", ")} → ${edge.to}.${edge.fk.refColumns.join(", ")}`;

  return (
    <g className={cn("transition-opacity duration-200", dim && "opacity-20")}>
      <title>{label}</title>
      {/* The wire itself. */}
      <path
        className={cn("transition-colors", lit ? "stroke-foreground/60" : "stroke-border")}
        d={d}
        fill="none"
        strokeWidth={1.5}
      />
      {/* The pulse: a dash one PULSE_LEN long on a path normalised to 1, walked one period per
          cycle so exactly one pulse is on the wire at a time. Staggered by index so the picture
          does not blink in unison. */}
      {animate && (
        <motion.path
          animate={{ pathOffset: [-(1 + PULSE_LEN), 0] }}
          className={cn("transition-colors", lit ? "stroke-info" : "stroke-info/70")}
          d={d}
          fill="none"
          initial={{ pathLength: PULSE_LEN, pathSpacing: 1, pathOffset: -(1 + PULSE_LEN) }}
          strokeLinecap="round"
          strokeWidth={2}
          transition={{
            duration: TRAVEL_S,
            ease: "linear",
            repeat: Infinity,
            delay: (index % 6) * (TRAVEL_S / 6),
          }}
        />
      )}
      {/* Crow's foot at the referencing end: many rows can hold the same key. */}
      <path
        className={cn("transition-colors", lit ? "stroke-foreground/60" : "stroke-border")}
        d={`M ${start.x + startDir * 9} ${start.y} L ${start.x} ${start.y - 5} M ${start.x + startDir * 9} ${start.y} L ${start.x} ${start.y + 5}`}
        fill="none"
        strokeWidth={1.5}
      />
      {/* A bar at the referenced end: one row is the key. */}
      <path
        className={cn("transition-colors", lit ? "stroke-foreground/60" : "stroke-border")}
        d={`M ${end.x + endDir * 7} ${end.y - 5} L ${end.x + endDir * 7} ${end.y + 5}`}
        fill="none"
        strokeWidth={1.5}
      />
    </g>
  );
}

/* ------------------------------------------------------------------ cards */

const KIND_ICON = {
  table: Table2Icon,
  view: EyeIcon,
  materialized_view: LayersIcon,
} as const;

function TableCard({
  at,
  dim,
  dragging,
  edges,
  node,
  onHover,
  onPointerDown,
  selected,
  showSchema,
}: {
  at: Point;
  dim: boolean;
  dragging: boolean;
  edges: readonly Edge[];
  node: Node;
  onHover: (key: string | null) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, key: string) => void;
  selected: boolean;
  showSchema: boolean;
}): React.ReactElement {
  const { table } = node;
  const Icon = KIND_ICON[table.kind];

  // Which columns hold a foreign key, and where it points, for the row marker and its tooltip.
  const references = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const fk of table.foreignKeys) {
      fk.columns.forEach((column, index) => {
        map.set(column, `${fk.refTable}.${fk.refColumns[index] ?? fk.refColumns[0] ?? ""}`);
      });
    }
    return map;
  }, [table.foreignKeys]);

  const referencedBy = React.useMemo(
    () => edges.filter((edge) => edge.to === node.key).length,
    [edges, node.key],
  );

  return (
    <div
      className={cn(
        "absolute top-(--y) left-(--x) w-64 overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm/5",
        "transition-opacity duration-200",
        dragging ? "cursor-grabbing shadow-lg/10" : "cursor-grab",
        selected && "border-ring ring-2 ring-ring/40",
        dim && "opacity-40",
      )}
      data-selected={selected || undefined}
      onPointerDown={(event) => onPointerDown(event, node.key)}
      onPointerEnter={() => onHover(node.key)}
      onPointerLeave={() => onHover(null)}
      style={{ "--x": `${at.x}px`, "--y": `${at.y}px` } as React.CSSProperties}
    >
      <div className="flex h-8 items-center gap-1.5 border-b bg-muted/60 px-2.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium text-sm">
          {showSchema && <span className="text-muted-foreground">{table.schema}.</span>}
          {table.name}
        </span>
        {table.rowEstimate !== undefined && (
          <span className="ms-auto shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
            ~{table.rowEstimate}
          </span>
        )}
      </div>
      <div className="py-1">
        {table.columns.length === 0 ? (
          <div className="flex h-6 items-center px-2.5 text-muted-foreground text-xs">No columns</div>
        ) : (
          table.columns.map((column) => (
            <ColumnRow
              column={column}
              key={column.name}
              referenced={column.pk && referencedBy > 0}
              reference={references.get(column.name)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ColumnRow({
  column,
  reference,
  referenced,
}: {
  column: Column;
  /** `table.column` this column points at, when it holds a foreign key. */
  reference: string | undefined;
  /** A primary key some other table points at. */
  referenced: boolean;
}): React.ReactElement {
  const title = [
    `${column.name} ${column.type}${column.nullable ? " NULL" : " NOT NULL"}`,
    column.pk ? "Primary key" : null,
    reference ? `References ${reference}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-6 items-center gap-1.5 px-2.5 text-xs" title={title}>
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {column.pk ? (
          <KeyRoundIcon
            className={cn("size-3", referenced ? "text-warning-foreground" : "text-warning-foreground/70")}
          />
        ) : reference ? (
          <Link2Icon className="size-3 text-info-foreground" />
        ) : (
          <span className="size-1 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <span className={cn("min-w-0 truncate", column.pk || reference ? "text-foreground" : "text-foreground/80")}>
        {column.name}
      </span>
      <span className="ms-auto shrink-0 truncate font-mono text-muted-foreground tabular-nums">
        {column.type}
        {column.nullable && <span className="text-muted-foreground/60">?</span>}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- chrome */

function ToolButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label={label} onClick={onClick} size="icon-sm" variant="ghost">
            {children}
          </Button>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function Legend({ noRelations }: { noRelations: boolean }): React.ReactElement {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-md border bg-popover/90 px-2.5 py-2 text-muted-foreground text-xs backdrop-blur-sm">
      {noRelations ? (
        <span>No foreign keys in this database, so the tables are laid out without wires.</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <KeyRoundIcon className="size-3 text-warning-foreground" /> Primary key
          </span>
          <span className="flex items-center gap-1.5">
            <Link2Icon className="size-3 text-info-foreground" /> Foreign key
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-info" /> Reference, many → one
          </span>
        </>
      )}
      <span className="text-muted-foreground/70">Drag to move · scroll to pan · ⌘ scroll to zoom</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}
