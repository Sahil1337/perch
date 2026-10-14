import type { Ref } from "react";
import { cn } from "../../../shared/cn";
import { Keycap } from "../../materials";
import { isLit, type Tile } from "./board";

/**
 * A table as a porcelain tile, its name glazed on top, standing on its place on the board. A tile
 * the dragged one doesn't touch rests dimmed, as the real view's focus leaves it.
 */
export function TableTile({ tile, topRef }: { tile: Tile; topRef?: Ref<HTMLElement> }) {
  return (
    <div data-tile={tile.table} className={cn("absolute -translate-1/2", tile.place, !isLit(tile) && "opacity-40")}>
      <Keycap size="md" topRef={topRef}>
        {tile.table}
      </Keycap>
    </div>
  );
}
