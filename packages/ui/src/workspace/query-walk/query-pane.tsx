"use client";

// "Your query": the whole statement the reader wrote, with the open chapter lit inside it.
//
// The walk runs a SECTION, and a section's text is not the reader's — it is a body trimmed out of
// the statement with a WITH prefix spliced onto the front, so quoting it here shows `with recursive
// chain as (…) select * from chain` to someone who never typed that line, and says nothing about
// where in their query the chapter sits. The answer to "where am I" is only visible if the whole
// query is on screen, so the whole query is what this renders, in four layers: everything outside
// the section dimmed, the section at full contrast, the current station's clause marked, and — for a
// CTE — the places the query READS it marked differently, because a CTE is declared at the top and
// used fifty lines down and the use is the part that answers the question.
//
// The layers are cut into non-overlapping runs before anything is rendered, so a clause that
// overlaps a use still comes out as one span carrying both, and each run is highlighted on its own.
//
// A null mapping is not an approximation. `Section.rootMap` is null when the section's text was
// invented rather than sliced — a recursive CTE's body, a CTE list merged into a prefix — and then
// no offset inside it is an offset in the query on screen. Rather than guess, the pane falls back to
// the section's own text exactly as it did before: a highlight in the wrong place reads as a fact
// about the query and is believed.

import * as React from "react";
import { cn } from "../../lib/utils";
import { highlightSql } from "../sql-editor/highlight-sql";
import type { Range } from "./clauses";
import { toRootRange, type Section } from "./program";
import type { Station } from "./steps";

/**
 * The range in the ROOT text the station is about, or null when it has none to offer.
 *
 * A station's `clause` indexes the section's own text, which is why it has to be mapped back; a
 * station may instead carry `root`, already in root coordinates, for the stations whose section text
 * the walk invented and whose `clause` therefore indexes nothing the reader wrote. `root` wins when
 * it is set, precisely because it is set only where the mapped clause would have been wrong.
 */
export function stationRange(section: Section | null, station: Station): Range | null {
  const pinned = station.root;
  if (pinned !== null) return pinned;
  if (section === null || station.clause === null) return null;
  return toRootRange(section, station.clause);
}

const EMPTY: readonly Range[] = [];

/** One run of text with the layers it belongs to: what is cut, not what is drawn. */
type Run = {
  readonly text: string;
  readonly inside: boolean;
  readonly mark: boolean;
  readonly use: boolean;
};

function within(range: Range | null, from: number, to: number): boolean {
  return range !== null && range.from <= from && to <= range.to;
}

/**
 * The text cut at every layer boundary, so no run ever straddles one.
 *
 * Only offsets strictly inside the text are cut points; an out-of-bounds end is simply not a
 * boundary, which leaves its layer running to the edge rather than dropping it.
 */
function runs(
  text: string,
  source: Range | null,
  mark: Range | null,
  uses: readonly Range[],
): Run[] {
  const edges = new Set<number>([0, text.length]);
  for (const range of [source, mark, ...uses]) {
    if (range === null) continue;
    for (const edge of [range.from, range.to]) if (edge > 0 && edge < text.length) edges.add(edge);
  }
  const cuts = [...edges].sort((a, b) => a - b);
  const out: Run[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!;
    const to = cuts[i + 1]!;
    out.push({
      text: text.slice(from, to),
      inside: within(source, from, to),
      mark: within(mark, from, to),
      use: uses.some((range) => within(range, from, to)),
    });
  }
  return out;
}

export function QueryPane({
  root,
  section,
  station,
  fallback,
}: {
  /** `Program.text`: the statement as written, with its comments already stripped out. */
  root: string;
  /** The open chapter, or null when there is none to place. */
  section: Section | null;
  station: Station;
  /** The section's own text, shown when the section cannot be placed in `root`. */
  fallback: string;
}): React.ReactElement {
  // A section with no mapping can still be shown in place IF the station knows its own root range —
  // that range was computed against the root and needs no mapping to be true. Without either, the
  // root would render with nothing lit and no chapter marked, which is less than the old pane gave.
  //
  // Memoised because `toRootRange` returns a fresh object every time it is asked: unmemoised, the
  // runs below would be recut and the scroll effect refired on every frame the player renders,
  // rather than on the station changes that are the only thing either one is about.
  const pinned = React.useMemo(() => stationRange(section, station), [section, station]);
  const placed =
    section !== null && section.source !== null && (section.rootMap !== null || pinned !== null);

  const text = placed ? root : fallback;
  const source = placed ? section.source : null;
  const mark = placed ? pinned : station.clause;
  const uses = placed ? section.uses : EMPTY;

  const parts = React.useMemo(() => runs(text, source, mark, uses), [mark, source, text, uses]);
  const first = parts.findIndex((part) => part.mark);

  // The pane holds the whole statement now, so the marked clause is regularly below the fold of the
  // panel it sits in. `nearest` is the point: it brings the mark into the panel without yanking the
  // dialog around it when the mark is already visible.
  const marked = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    marked.current?.scrollIntoView({ block: "nearest" });
  }, [parts, first]);

  return (
    <pre className="whitespace-pre-wrap font-mono text-sm leading-6">
      {parts.map((part, index) => {
        const content = highlightSql(part.text);
        // The mark is never dimmed, wherever it landed: it is the one thing the reader is being
        // pointed at. Everything else outside the open chapter recedes.
        const dim = !part.mark && !part.use && !part.inside;
        const use = part.use
          ? "underline decoration-info/60 decoration-dotted underline-offset-4"
          : null;
        if (part.mark) {
          return (
            <mark
              className={cn("rounded-sm bg-info/10 text-inherit", use)}
              key={index}
              ref={index === first ? marked : undefined}
            >
              {content}
            </mark>
          );
        }
        return (
          <span
            className={cn(dim && "opacity-40", use)}
            key={index}
            title={part.use && section ? `where the query reads ${section.label}` : undefined}
          >
            {content}
          </span>
        );
      })}
    </pre>
  );
}
