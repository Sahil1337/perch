"use client";

import { useReducedMotion } from "motion/react";
import * as React from "react";
import { intersects } from "./geometry";
import { TableCard } from "./table-card";
import type { Drag } from "./use-diagram-drag";
import type { DiagramLayout } from "./use-diagram-layout";
import type { DiagramView } from "./use-diagram-view";
import { WirePath, type WireState } from "./wire-path";
import { routeWires, wireBounds } from "./wires";

/** The panned, zoomed plane: every table as a card, every foreign key as a wire between two rows. */
export function DiagramCanvas({
  drag,
  hovered,
  layout,
  onCardPointerDown,
  onHover,
  selected,
  showSchema,
  view,
}: {
  drag: Drag | null;
  hovered: string | null;
  layout: DiagramLayout;
  onCardPointerDown: (event: React.PointerEvent<HTMLDivElement>, key: string) => void;
  onHover: (key: string | null) => void;
  selected: string | null;
  showSchema: boolean;
  view: DiagramView;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const { graph, nodeByKey, positions } = layout;

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

  return (
    <div
      className="absolute top-0 left-0 origin-top-left translate-x-(--pan-x) translate-y-(--pan-y) scale-(--zoom)"
      ref={view.canvasRef}
      /* `livePan` rather than `view.pan`: a pan gesture writes the transform straight to this
         node and tells React on release, so a render that happens in between — a hover, a
         card drag — must agree with what is already on screen instead of snapping it back. */
      style={
        {
          "--pan-x": `${(view.livePan.current ?? view.pan).x}px`,
          "--pan-y": `${(view.livePan.current ?? view.pan).y}px`,
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
              animate={!reduced && state !== "hidden" && intersects(wireBounds(wire), view.visible)}
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
            onHover={onHover}
            onPointerDown={onCardPointerDown}
            onToggle={layout.toggleCard}
            referenced={referenced.has(node.key)}
            selected={selected === node.key}
            showSchema={showSchema}
          />
        );
      })}
    </div>
  );
}
