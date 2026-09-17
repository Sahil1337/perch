// What the stage shows for a (station, phase), built from the real step results. Pure. The parts
// live alongside: `types` for the shapes, `results` for reading a station's queries, `columns` for
// turning a sample into cards' columns and rows, `view` for assembling a scene, `context` for what
// every builder needs, and `station/` for one builder per clause.

import type { WalkData } from "../use-walk";
import { combineScene } from "./station/combine";
import { sceneContext } from "./context";
import { distinctScene } from "./station/distinct";
import { filterScene } from "./station/filter";
import { fromScene } from "./station/from";
import { groupScene } from "./station/group";
import { joinScene } from "./station/join";
import { limitScene } from "./station/limit";
import { orderScene } from "./station/order";
import { resultScene } from "./station/result";
import { selectScene } from "./station/select";
import { windowScene } from "./station/window";
import { EMPTY, type Scene } from "./types";
import { capCols } from "./view";

export type {
  AnswerView,
  BucketView,
  Col,
  GridCellView,
  GridGroup,
  GridRowView,
  GridView,
  NearRow,
  Row,
  Scene,
  Summary,
  TableView,
  TerminusView,
  ValueChip,
} from "./types";
export { answerView } from "./answer";
export { boundScene, innerCard } from "./bound";
export { gridScene } from "./grid";
export { countAt, countValue, errorOf, inputCount, previousIndex, sampleId } from "./results";

export function buildScene(index: number, phase: number, walk: WalkData): Scene {
  const scene = sceneAt(index, phase, walk);
  // The grid's own column axis is capped where it is built — by dropping driving rows, not by
  // narrowing the card — so only the ordinary cards beside it go through the width cap.
  if (scene.kind === "buckets") return scene;
  return { ...scene, tables: scene.tables.map(capCols) };
}

function sceneAt(index: number, phase: number, walk: WalkData): Scene {
  const station = walk.stations[index];
  if (!station) return EMPTY;
  // Before the `parsed === null` fall-through below, because a set-op walk has no parse either and
  // would otherwise be handed to `resultScene`, which knows only how to draw one card.
  if (station.id === "combine") return combineScene(station, phase, walk.results[index]);
  // Both checks say the same thing from either end: a result-only walk has this one station and no
  // parse, and `sceneContext` would need the parse's sources on its first line.
  if (station.id === "result" || walk.parsed === null) return resultScene(walk.results[index]);
  const ctx = sceneContext(index, phase, walk, station, walk.parsed);

  switch (station.id) {
    case "from":
      return fromScene(ctx);
    case "join":
      return joinScene(ctx);
    case "where":
    case "having":
      return filterScene(ctx);
    case "group":
      return groupScene(ctx);
    case "window":
      return windowScene(ctx);
    case "select":
      return selectScene(ctx);
    case "distinct":
      return distinctScene(ctx);
    case "order":
      return orderScene(ctx);
    case "limit":
      return limitScene(ctx);
  }
}
