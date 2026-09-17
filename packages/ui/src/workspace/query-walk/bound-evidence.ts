"use client";

// What a bound chapter learned, kept where a later chapter can read it.
//
// The per-row ledger's numbers live inside its own view, and a view unmounts the moment playback
// moves on — so by the time the walk reaches the final station, the one thing that explains an empty
// result has just been thrown away. This is the shelf it is put on instead: a section reports what
// its probes brought back as they land, and the terminus reads it.
//
// It is a CACHE OF WHAT ALREADY RAN and never a reason to run anything. Nothing here sends a
// statement, and a section the reader never reached simply has no entry — which is why the terminus
// asks whether the counts are known rather than asking for them.

import * as React from "react";
import type { SectionId } from "./program";
import type { BoundEvidence } from "./terminus";

type EvidenceStore = {
  readonly evidence: ReadonlyMap<SectionId, BoundEvidence>;
  readonly report: (id: SectionId, found: BoundEvidence) => void;
};

const NONE: ReadonlyMap<SectionId, BoundEvidence> = new Map();

export const EvidenceContext = React.createContext<EvidenceStore>({
  evidence: NONE,
  report: () => undefined,
});

/**
 * The store itself, held by the player for the life of one program.
 *
 * `key` resets it during render rather than in an effect, the same way `useProgram` resets its own
 * results: an effect runs after the paint, which is one frame of the new query's terminus explaining
 * the old query's rows — and being wrong about which rows are on screen is exactly what this card
 * cannot be.
 */
export function useEvidenceStore(key: unknown): EvidenceStore {
  const [state, setState] = React.useState<{ key: unknown; map: ReadonlyMap<SectionId, BoundEvidence> }>(
    () => ({ key, map: NONE }),
  );
  if (state.key !== key) setState({ key, map: NONE });
  const map = state.key === key ? state.map : NONE;

  const report = React.useCallback((id: SectionId, found: BoundEvidence) => {
    setState((previous) =>
      previous.map.get(id) === found
        ? previous
        : { key: previous.key, map: new Map(previous.map).set(id, found) },
    );
  }, []);

  return React.useMemo(() => ({ evidence: map, report }), [map, report]);
}

/** Files a section's evidence as it changes. Null while its probes are still out, which files
 *  nothing — a half-filled ledger would give the terminus a count for some rows and not others. */
export function useReportEvidence(id: SectionId, found: BoundEvidence | null): void {
  const { report } = React.useContext(EvidenceContext);
  React.useEffect(() => {
    if (found !== null) report(id, found);
  }, [found, id, report]);
}
