import { type Ref, useRef } from "react";
import { useLoop } from "../../materials";
import { DRAGGED, TILES } from "./board";
import { relationsLoop } from "./loop";
import { Threads } from "./threads";
import { TableTile } from "./tile";

/**
 * Relationship View told in porcelain: a tile per table, threads along the real foreign keys, one
 * tile dragged into line with its threads following, then the focus that dims what it doesn't touch.
 * The bird rides the dragged tile.
 */
export function RelationsPiece({ perchRef }: { perchRef: Ref<HTMLElement> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLoop(ref, relationsLoop);
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 flex items-center justify-center">
      <div className="@container relative h-44 w-72 shrink-0 lg:h-66 lg:w-108">
        <Threads />
        {TILES.map((tile) => (
          <TableTile key={tile.table} tile={tile} topRef={tile.table === DRAGGED ? perchRef : undefined} />
        ))}
      </div>
    </div>
  );
}
