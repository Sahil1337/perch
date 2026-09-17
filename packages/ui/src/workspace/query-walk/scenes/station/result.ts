// RESULT: the whole of a section that produces a table but has no clauses to step through — a
// VALUES list, a SELECT with no FROM, a CTE the slicer could not take apart.
//
// One card, the same `TableView` vocabulary the FROM station draws its sources with, because these
// rows are exactly that: a table that already exists by the time anything reads it. It is the only
// builder here that takes no `SceneContext` — a section with no clauses has no sources, no station
// before it and no chain title, so the context every other builder is handed cannot be computed and
// is not wanted.

import type { StationResult } from "../../use-walk";
import { countValue, errorOf, okResult } from "../results";
import type { Scene } from "../types";
import { plain, tables } from "../view";

export function resultScene(result: StationResult | undefined): Scene {
  // Not a `SceneContext` builder: a result-only section has no parse to build one from, so this one
  // reads its sample itself.
  const sample = okResult(result, "sample");
  const total = countValue(result, "count");
  if (!sample) {
    // The error goes on the card rather than in place of it, so the reader still sees WHICH section
    // could not run — a bare empty stage would read as "this chapter is not part of the query".
    return tables(
      [
        {
          key: "main",
          title: "result",
          cols: [],
          rows: [],
          total,
          error: errorOf(result, "sample") ?? undefined,
        },
      ],
      total,
    );
  }
  return tables([plain("main", "result", sample, total)], total);
}
