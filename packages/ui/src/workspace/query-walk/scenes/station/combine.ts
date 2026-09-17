// COMBINE: where two results of a set-operator chain meet.
//
// Three beats. The two sides as they arrived, then the regions they share, then what the operator
// kept. The middle beat is the one that took a while to exist, and the reason is worth keeping in
// front of whoever edits this next: the two side cards hold 25 sampled rows each, so deciding here
// which of them survived an INTERSECT — by comparing the samples in JavaScript — would mark a row
// as dropped whenever its partner happened to fall outside the other sample. Nothing in this file
// compares rows. Each region is a set operation the database evaluated over the FULL branches, and
// this only lays the answers out.
//
// `ALL` stations arrive with no region batch at all (see `buildSetStations`): duplicates are what
// makes them different, and the regions describe distinct rows. They play two beats, not three.

import type { Station } from "../../steps";
import type { StationResult } from "../../use-walk";
import { countValue, errorOf, okResult } from "../results";
import type { Scene, TableView } from "../types";
import { plain, tables } from "../view";

/** The regions an operator keeps. The whole point of drawing them: this is the operator's meaning. */
function keeps(op: string): { onlyLeft: boolean; both: boolean; onlyRight: boolean } {
  if (op.startsWith("UNION")) return { onlyLeft: true, both: true, onlyRight: true };
  if (op.startsWith("INTERSECT")) return { onlyLeft: false, both: true, onlyRight: false };
  return { onlyLeft: true, both: false, onlyRight: false };
}

/** One card, or a card carrying the reason it is empty-handed. A region that could not be computed
 *  says so: a blank card would read as "no rows here", which is a different and wrong claim. */
function card(result: StationResult | undefined, id: string, title: string): TableView {
  // The node's own answer rides on the bare `sample`/`count` ids, because `stationState` looks for
  // exactly those to decide the station is ready. Every other card is namespaced.
  const sampleId = id === "" ? "sample" : `${id}.sample`;
  const countId = id === "" ? "count" : `${id}.count`;
  const key = id === "" ? "main" : id;
  const sample = okResult(result, sampleId);
  const total = countValue(result, countId);
  if (!sample) {
    return {
      key,
      title,
      cols: [],
      rows: [],
      total,
      error: errorOf(result, sampleId) ?? undefined,
      empty: "This region could not be computed, so it is not being shown as empty.",
    };
  }
  return plain(key, title, sample, total);
}

export function combineScene(
  station: Station,
  phase: number,
  result: StationResult | undefined,
): Scene {
  const word = station.label.replace(/ \d+$/, "");
  const hasRegions = station.batches.length > 1;
  const resultCount = countValue(result, "count");

  // Beat 1: the two results as they arrived, side by side.
  if (phase === 0) {
    return tables(
      [
        card(result, "left", "the left-hand result"),
        card(result, "right", "the right-hand result"),
      ],
      null,
      false,
    );
  }

  // Beat 2: the regions, each tinted by whether this operator keeps it.
  if (hasRegions && phase === 1) {
    const kept = keeps(word);
    // The region an operator's own answer already IS — see `buildSetStations`, which does not send
    // that query twice. Reading it off `sample` is not an inference: it is the same statement.
    const isResult = word.startsWith("INTERSECT")
      ? "both"
      : word.startsWith("EXCEPT")
        ? "onlyLeft"
        : null;
    const region = (id: string, title: string, survives: boolean): TableView => {
      const view = card(
        result,
        id === isResult ? "" : id,
        `${title} — ${survives ? "kept" : "dropped"}`,
      );
      return {
        ...view,
        settled: true,
        rows: view.rows.map((row) => ({
          ...row,
          verdict: survives ? ("pass" as const) : ("fail" as const),
        })),
      };
    };
    return tables(
      [
        region("onlyLeft", "only on the left", kept.onlyLeft),
        region("both", "in both", kept.both),
        region("onlyRight", "only on the right", kept.onlyRight),
      ],
      null,
      false,
    );
  }

  // Beat 3: what the operator actually returned — the database's own answer, not the regions added up.
  return tables([card(result, "", `after ${word}`)], resultCount);
}
