// Everything a station builder needs that is worth computing once: the sources it draws from, the
// counts either side of it, and what the station before it left on the stage. Built at the top of
// `sceneAt` and handed to whichever builder the station id picks.

import type { StatementResult } from "@perch/protocol";
import type { ParsedSelect, SourceRef } from "../clauses";
import { sourceTitle, type Station } from "../steps";
import type { StationResult, WalkData } from "../use-walk";
import { countAt, inputCount, previousIndex, sampleOf } from "./results";

export type SceneContext = {
  readonly walk: WalkData;
  /** The section's clauses. Handed in rather than read off `walk`, which cannot promise one: a
   *  result-only walk has no parse, and it never reaches a builder that takes this. */
  readonly parsed: ParsedSelect;
  readonly index: number;
  readonly phase: number;
  readonly station: Station;
  readonly result: StationResult | undefined;
  readonly sources: readonly SourceRef[];
  readonly tableOf: (qualifier: string) => string | null;
  readonly chainTitle: (through: number) => string;
  readonly input: number | null;
  readonly own: number | null;
  readonly prevSample: StatementResult | null;
  readonly prevStation: Station | null;
  readonly mainTitle: string;
};

export function sceneContext(
  index: number,
  phase: number,
  walk: WalkData,
  station: Station,
  parsed: ParsedSelect,
): SceneContext {
  const result = walk.results[index];
  const sources = [parsed.first, ...parsed.joins.map((join) => join.source)];
  const tableOf = (qualifier: string): string | null =>
    sources.find((source) => (source.alias ?? source.name).toLowerCase() === qualifier.toLowerCase())
      ?.name ?? null;
  const chainTitle = (through: number): string =>
    sources
      .slice(0, through + 1)
      .map(sourceTitle)
      .join(" ⋈ ");
  const input = inputCount(walk, index);
  const own = countAt(walk, index);
  const previous = previousIndex(walk, index);
  const prevSample = previous === null ? null : sampleOf(walk, previous);
  const prevStation = previous === null ? null : walk.stations[previous]!;
  const mainTitle =
    prevStation?.id === "group" || prevStation?.id === "having"
      ? "groups"
      : station.id === "from"
        ? sourceTitle(parsed.first)
        : chainTitle(parsed.joins.length);

  return {
    walk,
    parsed,
    index,
    phase,
    station,
    result,
    sources,
    tableOf,
    chainTitle,
    input,
    own,
    prevSample,
    prevStation,
    mainTitle,
  };
}
