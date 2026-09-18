// A real schema has tables forty columns wide, which would make every card a screen tall, so past
// a threshold the view opens in keys-only mode: each card shows the columns that take part in a
// relation and a row saying how many it is not showing, and opens on request. Where the cards are
// dragged to is remembered per database, so the picture you arranged is the one you come back to.

import * as React from "react";
import { cn } from "../../lib/utils";
import { useWorkspace } from "../context";
import { asyncData } from "../types";
import { DiagramCanvas } from "./diagram-canvas";
import { Legend, Notice } from "./diagram-chrome";
import { DiagramToolbar } from "./diagram-toolbar";
import { useDiagramDrag } from "./use-diagram-drag";
import { useDiagramLayout } from "./use-diagram-layout";
import { useDiagramView } from "./use-diagram-view";

export function SchemaDiagram({ focus }: { focus?: string }): React.ReactElement {
  const { schema, database, connectionId } = useWorkspace();
  const data = asyncData(schema);

  const [selected, setSelected] = React.useState<string | null>(focus ?? null);
  const [hovered, setHovered] = React.useState<string | null>(null);

  const layout = useDiagramLayout({ connectionId, data, database });
  const view = useDiagramView({
    bounds: layout.bounds,
    focus,
    nodeByKey: layout.nodeByKey,
    nodeCount: layout.graph.nodes.length,
    positions: layout.positions,
  });
  const { drag, onCardPointerDown, onPointerMove, onPointerUp, onViewportPointerDown } =
    useDiagramDrag({ layout, setSelected, view });

  const tableCount = layout.graph.nodes.length;
  const relationCount = layout.graph.edges.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg/5">
      <DiagramToolbar
        counts={data ? { relations: relationCount, tables: tableCount } : null}
        database={database}
        keysOnly={layout.keysOnly}
        onFit={view.fit}
        onKeysOnly={layout.setKeysOnly}
        onReset={() => layout.resetLayout(view.fit)}
        onZoom={view.zoomBy}
        zoom={view.zoom}
      />

      <div
        className={cn(
          "relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-background",
          drag?.kind === "pan" ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerCancel={onPointerUp}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={view.viewportRef}
      >
        {data === undefined ? (
          <Notice>{schema.status === "error" ? schema.error : "Loading schema…"}</Notice>
        ) : tableCount === 0 ? (
          <Notice>No tables in this database.</Notice>
        ) : (
          <DiagramCanvas
            drag={drag}
            hovered={hovered}
            layout={layout}
            onCardPointerDown={onCardPointerDown}
            onHover={setHovered}
            selected={selected}
            showSchema={data.schemas.length > 1}
            view={view}
          />
        )}

        {data !== undefined && tableCount > 0 && <Legend noRelations={relationCount === 0} />}
      </div>
    </div>
  );
}
