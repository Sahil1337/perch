// What the stage shows for a (station, phase), built from the real step results. Pure. The parts
// live alongside: `types` for the shapes, `results` for reading a station's queries, `columns` for
// turning a sample into cards' columns and rows, `view` for assembling a scene, `context` for what
// every builder needs, and `station/` for one builder per clause.

import type { WalkData } from "../use-walk";
import { sceneContext } from "./context";
import { distinctScene } from "./station/distinct";
import { filterScene } from "./station/filter";
import { fromScene } from "./station/from";
import { groupScene } from "./station/group";
import { joinScene } from "./station/join";
import { limitScene } from "./station/limit";
import { orderScene } from "./station/order";
import { selectScene } from "./station/select";
import { windowScene } from "./station/window";
import { EMPTY, type Scene } from "./types";
import { capCols } from "./view";

export type { BucketView, Col, Row, Scene, Summary, TableView } from "./types";
export { countAt, countValue, errorOf, inputCount, previousIndex, sampleId } from "./results";

export function buildScene(index: number, phase: number, walk: WalkData): Scene {
  const scene = sceneAt(index, phase, walk);
  return scene.kind === "tables" ? { ...scene, tables: scene.tables.map(capCols) } : scene;
}

function sceneAt(index: number, phase: number, walk: WalkData): Scene {
  const station = walk.stations[index];
  if (!station) return EMPTY;
  const ctx = sceneContext(index, phase, walk, station);

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
