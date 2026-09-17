import { CORNER, GAP_X, LANE_GAP, LOOP_REACH, type Point, type Rect, rowCentre } from "./geometry";
import type { Edge, Node } from "./graph";

export type Wire = {
  edge: Edge;
  d: string;
  /** Where the wire leaves the referencing card, and which way it heads (+1 right, -1 left). */
  start: Point;
  startDir: 1 | -1;
  /** Where it meets the referenced card. */
  end: Point;
  endDir: 1 | -1;
  /** The x of the vertical leg. */
  lane: number;
};

type Draft = Omit<Wire, "d">;

/** The box a wire is drawn in, for deciding whether it is on screen. */
export function wireBounds(wire: Wire): Rect {
  const xs = [wire.start.x, wire.end.x, wire.lane];
  const ys = [wire.start.y, wire.end.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y: y - 1, w: Math.max(...xs) - x, h: Math.max(...ys) - y + 2 };
}

/**
 * Wires are orthogonal — out of the card, along, down, along, in — with the vertical leg in the
 * channel next to the referenced card. Wires that share a channel get their own lane in it, so a
 * key that five tables point at reads as five parallel legs meeting at the row rather than five
 * curves piling onto one point. A curve looked friendlier on one wire and became a tangle on six.
 */
export function routeWires(
  edges: readonly Edge[],
  nodeByKey: ReadonlyMap<string, Node>,
  positions: ReadonlyMap<string, Point>,
): Wire[] {
  const drafts: Draft[] = [];
  for (const edge of edges) {
    const from = nodeByKey.get(edge.from);
    const to = nodeByKey.get(edge.to);
    const fromAt = positions.get(edge.from);
    const toAt = positions.get(edge.to);
    if (!from || !to || !fromAt || !toAt) continue;

    const y1 = fromAt.y + rowCentre(edge.fromColumn);
    const y2 = toAt.y + rowCentre(edge.toColumn);
    const fromMid = fromAt.x + from.w / 2;

    let x1: number;
    let x2: number;
    let startDir: 1 | -1;
    let endDir: 1 | -1;
    let lane: number;
    if (toAt.x >= fromMid) {
      // Target to the right: out of our right edge, into its left.
      x1 = fromAt.x + from.w;
      x2 = toAt.x;
      startDir = 1;
      endDir = -1;
      lane = x2 - Math.min(GAP_X / 2, (x2 - x1) / 2);
    } else if (toAt.x + to.w <= fromMid) {
      x1 = fromAt.x;
      x2 = toAt.x + to.w;
      startDir = -1;
      endDir = 1;
      lane = x2 + Math.min(GAP_X / 2, (x1 - x2) / 2);
    } else {
      // Overlapping columns, or a table pointing at itself: loop out of both right edges.
      x1 = fromAt.x + from.w;
      x2 = toAt.x + to.w;
      startDir = 1;
      endDir = 1;
      lane = Math.max(x1, x2) + LOOP_REACH;
    }
    drafts.push({ edge, start: { x: x1, y: y1 }, startDir, end: { x: x2, y: y2 }, endDir, lane });
  }

  /* Spread the vertical legs that would land in the same channel. Ordered by where they start,
     so a leg from higher up takes the lane further from the target and the legs do not cross
     each other on the way in. */
  const channels = new Map<number, Draft[]>();
  for (const draft of drafts) {
    const key = Math.round(draft.lane / (GAP_X / 2));
    (channels.get(key) ?? channels.set(key, []).get(key))!.push(draft);
  }
  for (const group of channels.values()) {
    group.sort((a, b) => a.start.y - b.start.y || a.end.y - b.end.y);
    group.forEach((draft, index) => {
      // Legs heading in from the left fan out leftwards, from the right rightwards.
      const spread = (index - (group.length - 1) / 2) * LANE_GAP;
      draft.lane += draft.endDir === -1 ? -spread : spread;
    });
  }

  return drafts.map((draft) => ({ ...draft, d: orthogonalPath(draft) }));
}

function orthogonalPath({ start, end, lane }: Draft): string {
  const { x: x1, y: y1 } = start;
  const { x: x2, y: y2 } = end;
  if (Math.abs(y2 - y1) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dx1 = Math.sign(lane - x1);
  const dx2 = Math.sign(x2 - lane);
  const dy = Math.sign(y2 - y1);
  const r = Math.min(CORNER, Math.abs(y2 - y1) / 2, Math.abs(lane - x1), Math.abs(x2 - lane));
  return [
    `M ${x1} ${y1}`,
    `H ${lane - dx1 * r}`,
    `Q ${lane} ${y1} ${lane} ${y1 + dy * r}`,
    `V ${y2 - dy * r}`,
    `Q ${lane} ${y2} ${lane + dx2 * r} ${y2}`,
    `H ${x2}`,
  ].join(" ");
}
