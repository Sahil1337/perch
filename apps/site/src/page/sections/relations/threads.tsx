import { cn } from "../../../shared/cn";
import { BOARD, THREADS, touchesDragged } from "./board";

/**
 * The foreign keys as thin threads, centre to centre under the tiles, so only the span between two
 * tiles shows. Each is drawn on a board-sized layer of its own, which the loop moves whole; the
 * stroke keeps its width whatever the board's scale.
 */
export function Threads() {
  return THREADS.map((thread, index) => (
    <svg
      key={`${thread.from.table}-${thread.to.table}`}
      data-thread={index}
      viewBox={`0 0 ${BOARD.width} ${BOARD.height}`}
      fill="none"
      className={cn("absolute inset-0 size-full origin-top-left text-porcelain/45", !touchesDragged(thread) && "opacity-25")}
    >
      <line
        x1={thread.from.at.x}
        y1={thread.from.at.y}
        x2={thread.to.at.x}
        y2={thread.to.at.y}
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  ));
}
