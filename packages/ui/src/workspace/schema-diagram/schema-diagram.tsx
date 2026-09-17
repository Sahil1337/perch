"use client";

// A real schema has tables forty columns wide, which would make every card a screen tall, so past
// a threshold the view opens in keys-only mode: each card shows the columns that take part in a
// relation and a row saying how many it is not showing, and opens on request. Where the cards are
// dragged to is remembered per database, so the picture you arranged is the one you come back to.

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { KeyRoundIcon, RotateCcwIcon, ScanIcon, XIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { useWorkspace } from "../context";
import { asyncData } from "../types";
import { Legend, Notice, ToolButton } from "./diagram-chrome";
import { CARD_W, GAP_X, GAP_Y, intersects, type Point, type Rect } from "./geometry";
import { buildGraph, buildNode, type Graph, isWide, NO_TABLES } from "./graph";
import { autoLayout } from "./layout";
import { clearPositions, readPositions, storageKey, writePositions } from "./storage";
import { TableCard } from "./table-card";
import { WirePath, type WireState } from "./wire-path";
import { routeWires, wireBounds } from "./wires";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;
/** Padding kept around the graph when fitting it to the viewport. */
const FIT_PAD = 48;
/** Pointer travel under which a press-and-release is a click, not a drag. */
const CLICK_SLOP = 3;

const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };

type Drag =
  | { kind: "pan"; pointerId: number; origin: Point; pan: Point; moved: boolean }
  | { kind: "card"; pointerId: number; key: string; origin: Point; at: Point; moved: boolean };

/** The auto layout, with whatever this database's cards were dragged to last time put back. */
function initialPositions(graph: Graph, storeKey: string | null): Map<string, Point> {
  const positions = autoLayout(graph.nodes, graph.edges);
  const stored = readPositions(storeKey);
  if (stored) for (const [key, at] of stored) if (positions.has(key)) positions.set(key, at);
  return positions;
}

export function SchemaDiagram({ focus }: { focus?: string }): React.ReactElement {
  const { schema, database, connectionId } = useWorkspace();
  const data = asyncData(schema);
  const reduced = useReducedMotion();

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

  const [selected, setSelected] = React.useState<string | null>(focus ?? null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [view, setView] = React.useState<{ pan: Point; zoom: number }>({
    pan: { x: 0, y: 0 },
    zoom: 1,
  });
  const [drag, setDrag] = React.useState<Drag | null>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });

  /*
   * A pointer emits moves faster than the screen refreshes — a trackpad runs to 120Hz — and every
   * one of them used to be a React render of every card and every wire. Two things fix that.
   *
   * `schedule` coalesces: the LATEST piece of work runs, once, on the next frame. And a PAN never
   * reaches React at all while the gesture is live, because nothing about the picture depends on
   * where it is panned to except the transform itself, which is written straight to the node. The
   * final value is committed on release, which is when `visible` — and so which wires pulse — is
   * worth recomputing. A card drag still goes through state: the wires have to follow the card.
   */
  const frame = React.useRef<number | null>(null);
  const pending = React.useRef<(() => void) | null>(null);
  const schedule = React.useCallback((work: () => void): void => {
    pending.current = work;
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const run = pending.current;
      pending.current = null;
      run?.();
    });
  }, []);
  const flush = React.useCallback((): void => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);
  React.useEffect(() => flush, [flush]);

  /** Where the pan is right now, which during a gesture is ahead of `view.pan`. */
  const livePan = React.useRef<Point | null>(null);
  /** Wheel deltas banked since the last frame, so a trackpad flick is one render, not forty. */
  const wheelPan = React.useRef<Point>({ x: 0, y: 0 });

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = (): void => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const wires = React.useMemo(
    () => routeWires(graph.edges, nodeByKey, positions),
    [graph.edges, nodeByKey, positions],
  );

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

  /** Tables some other table points at: the key icon on their primary key is the lit one. */
  const referenced = React.useMemo(
    () => new Set(graph.edges.map((edge) => edge.to)),
    [graph.edges],
  );

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

  /** What the viewport shows, in canvas coordinates. A pulse on a wire outside it is not drawn. */
  const visible = React.useMemo<Rect>(
    () => ({
      x: -view.pan.x / view.zoom,
      y: -view.pan.y / view.zoom,
      w: viewportSize.width / view.zoom,
      h: viewportSize.height / view.zoom,
    }),
    [view, viewportSize],
  );

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
        wheelPan.current.x -= event.deltaX;
        wheelPan.current.y -= event.deltaY;
        schedule(() => {
          const banked = wheelPan.current;
          wheelPan.current = { x: 0, y: 0 };
          setView((previous) => ({
            ...previous,
            pan: { x: previous.pan.x + banked.x, y: previous.pan.y + banked.y },
          }));
        });
      }
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [schedule, zoomBy]);

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

  const resetLayout = (): void => {
    clearPositions(storeKey);
    setExpanded(NO_TABLES);
    setLayout({ graph: baseGraph, positions: autoLayout(baseGraph.nodes, baseGraph.edges) });
    // Positions land on the next render; fit reads them then.
    window.requestAnimationFrame(fit);
  };

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
      const pan = { x: drag.pan.x + dx, y: drag.pan.y + dy };
      livePan.current = pan;
      schedule(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.style.setProperty("--pan-x", `${pan.x}px`);
        canvas.style.setProperty("--pan-y", `${pan.y}px`);
      });
    } else {
      const next = { x: drag.at.x + dx / view.zoom, y: drag.at.y + dy / view.zoom };
      schedule(() =>
        setLayout((previous) => ({
          ...previous,
          positions: new Map(previous.positions).set(drag.key, next),
        })),
      );
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Whatever the last frame was going to do, do it now — a gesture that ends between frames
    // would otherwise drop its final millimetre of travel.
    flush();
    const panned = livePan.current;
    livePan.current = null;
    if (panned) setView((previous) => ({ ...previous, pan: panned }));
    if (!drag.moved) {
      // A click: on a card selects it (again to clear); on the canvas clears.
      setSelected((previous) => (drag.kind === "card" && previous !== drag.key ? drag.key : null));
    } else if (drag.kind === "card") {
      writePositions(storeKey, positions);
    }
    setDrag(null);
  };

  const tableCount = graph.nodes.length;
  const relationCount = graph.edges.length;
  const showSchema = (data?.schemas.length ?? 0) > 1;

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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-pressed={keysOnly}
                  onClick={() => setKeysOnly(!keysOnly)}
                  size="xs"
                  variant={keysOnly ? "secondary" : "ghost"}
                >
                  <KeyRoundIcon />
                  Keys only
                </Button>
              }
            />
            <TooltipPopup>
              {keysOnly ? "Show every column" : "Show only the columns that take part in a relation"}
            </TooltipPopup>
          </Tooltip>
          <div aria-hidden className="mx-1 h-4 w-px bg-border" />
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
          <ToolButton label="Reset layout" onClick={resetLayout}>
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
            ref={canvasRef}
            /* `livePan` rather than `view.pan`: a pan gesture writes the transform straight to this
               node and tells React on release, so a render that happens in between — a hover, a
               card drag — must agree with what is already on screen instead of snapping it back. */
            style={
              {
                "--pan-x": `${(livePan.current ?? view.pan).x}px`,
                "--pan-y": `${(livePan.current ?? view.pan).y}px`,
                "--zoom": view.zoom,
              } as React.CSSProperties
            }
          >
            {/* Its own compositing layer. The pulses animate `stroke-dashoffset`, which is a paint,
                not a transform, so every frame re-rasters whatever shares a layer with them —
                promoting the wires keeps that off the cards, which are the expensive thing to
                raster and never move while a pulse travels. */}
            <svg
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 overflow-visible will-change-transform"
              height={1}
              width={1}
            >
              {wires.map((wire, index) => {
                const touches = wire.edge.from === active || wire.edge.to === active;
                const state: WireState =
                  active === null ? "idle" : touches ? "lit" : selected ? "hidden" : "muted";
                return (
                  <WirePath
                    animate={!reduced && state !== "hidden" && intersects(wireBounds(wire), visible)}
                    index={index}
                    key={wire.edge.id}
                    // Held still for the duration of a gesture: a pan or a drag is already asking
                    // the compositor for every frame it has, and a paused animation costs nothing.
                    paused={drag !== null}
                    state={state}
                    wire={wire}
                  />
                );
              })}
            </svg>

            {graph.nodes.map((node) => {
              const at = positions.get(node.key);
              if (!at) return null;
              return (
                <TableCard
                  at={at}
                  dim={selected !== null && related !== null && !related.has(node.key)}
                  dragging={drag?.kind === "card" && drag.key === node.key}
                  key={node.key}
                  node={node}
                  onHover={setHovered}
                  onPointerDown={onCardPointerDown}
                  onToggle={toggleCard}
                  referenced={referenced.has(node.key)}
                  selected={selected === node.key}
                  showSchema={showSchema}
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
