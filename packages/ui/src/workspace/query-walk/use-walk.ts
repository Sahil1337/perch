"use client";

// Runs a walk's stations through `probe`, one station at a time, in order. Each batch is one probe
// call carrying its statements separated by `;`; the server runs them in order and stops at the
// first failure, so a completed statement is in `results` by position and the one after them is
// the one that threw. Results land per station as they arrive, so the player can start on the
// first station while the rest are still loading.
//
// `useProgram` runs the same loop once per section of a program, in the program's own order, so a
// section's dependencies have already been computed by the time it starts.

import type { RunRecord, StatementResult } from "@perch/protocol";
import * as React from "react";
import { isSetOp, type ParsedSelect } from "./clauses";
import type { Program, Section } from "./program";
import { buildStations, SAMPLE_ROWS, type Station } from "./steps";

export type QueryOutcome =
  | { readonly ok: true; readonly result: StatementResult }
  | { readonly ok: false; readonly error: string; readonly skipped: boolean };

export type StationResult = {
  readonly status: "pending" | "loading" | "done";
  readonly queries: Readonly<Record<string, QueryOutcome>>;
};

export type WalkData = {
  readonly parsed: ParsedSelect;
  readonly stations: readonly Station[];
  readonly results: readonly StationResult[];
};

export type StationState = "absent" | "loading" | "failed" | "ready";

export type Probe = (sql: string, options?: { maxRows?: number }) => Promise<RunRecord>;

const PENDING: StationResult = { status: "pending", queries: {} };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Walks `stations` in order, reporting each one as its batches land.
 *
 * A plain function rather than the body of an effect, because a program runs it once per section:
 * the batch bookkeeping above is the subtle part of this file and two copies of it would drift.
 * `cancelled` is read fresh after every await so an unmounted walk stops mid-flight.
 */
export async function runStations(
  stations: readonly Station[],
  probe: Probe,
  report: (index: number, result: StationResult) => void,
  cancelled: () => boolean,
): Promise<void> {
  for (const [index, station] of stations.entries()) {
    if (!station.present) continue;
    report(index, { status: "loading", queries: {} });
    const queries: Record<string, QueryOutcome> = {};
    for (const batch of station.batches) {
      try {
        const record = await probe(batch.map((query) => query.sql).join(";\n"), {
          maxRows: SAMPLE_ROWS,
        });
        if (cancelled()) return;
        const done = record.results ?? [];
        batch.forEach((query, position) => {
          const result = done[position];
          if (result) queries[query.id] = { ok: true, result };
          else if (position === done.length && record.error)
            queries[query.id] = { ok: false, error: record.error.message, skipped: false };
          else
            queries[query.id] = {
              ok: false,
              error: "Not run: an earlier statement in this step failed.",
              skipped: true,
            };
        });
      } catch (error) {
        if (cancelled()) return;
        const message = messageOf(error);
        for (const query of batch) queries[query.id] = { ok: false, error: message, skipped: false };
      }
      report(index, { status: "loading", queries: { ...queries } });
    }
    report(index, { status: "done", queries });
  }
}

export function useWalk(parsed: ParsedSelect, probe: Probe): WalkData {
  const stations = React.useMemo(() => buildStations(parsed), [parsed]);
  const [results, setResults] = React.useState<readonly StationResult[]>(() =>
    stations.map(() => PENDING),
  );

  React.useEffect(() => {
    let cancelled = false;
    setResults(stations.map(() => PENDING));
    void runStations(
      stations,
      probe,
      (index, result) => {
        if (cancelled) return;
        setResults((previous) => previous.map((entry, i) => (i === index ? result : entry)));
      },
      () => cancelled,
    );

    return () => {
      cancelled = true;
    };
  }, [stations, probe]);

  return { parsed, stations, results };
}

/**
 * Where a section of a program has got to.
 *
 * `bound` is the one that is not a phase of loading: the section runs once per row of its outer
 * section, which wave 4 adds. Its stations are built — the walk is real and can be shown — but
 * probing it once here would run a query whose correlated columns have nothing bound to them and
 * present the answer as if it meant something, so nothing is run at all.
 */
export type SectionStatus = "pending" | "running" | "done" | "bound" | "unwalkable";

export type SectionRun = {
  readonly section: Section;
  readonly status: SectionStatus;
  /** Null when there is no station walk: a set operation combines its branches rather than
   *  stepping through clauses of its own. */
  readonly walk: WalkData | null;
};

export type ProgramData = {
  readonly program: Program;
  readonly sections: readonly SectionRun[];
};

type SectionPlan = {
  readonly section: Section;
  readonly parsed: ParsedSelect | null;
  readonly stations: readonly Station[];
  readonly status: SectionStatus;
};

type SectionState = {
  readonly status: SectionStatus;
  readonly results: readonly StationResult[];
};

function planSection(section: Section): SectionPlan {
  const parsed = isSetOp(section.parsed) ? null : section.parsed;
  const status: SectionStatus =
    parsed === null ? "unwalkable" : section.binding.kind === "bound" ? "bound" : "pending";
  return { section, parsed, stations: parsed ? buildStations(parsed) : [], status };
}

const initialState = (plan: SectionPlan): SectionState => ({
  status: plan.status,
  results: plan.stations.map(() => PENDING),
});

export function useProgram(program: Program, probe: Probe): ProgramData {
  const plans = React.useMemo(() => program.sections.map(planSection), [program]);
  const [state, setState] = React.useState<readonly SectionState[]>(() => plans.map(initialState));

  React.useEffect(() => {
    let cancelled = false;
    setState(plans.map(initialState));
    const patch = (index: number, change: (entry: SectionState) => SectionState): void => {
      if (cancelled) return;
      setState((previous) => previous.map((entry, i) => (i === index ? change(entry) : entry)));
    };

    void (async () => {
      // Program order is dependency order, so a section's inputs are already computed when it
      // starts and there is nothing to schedule beyond running the list.
      for (const [index, plan] of plans.entries()) {
        if (plan.status !== "pending") continue;
        patch(index, (entry) => ({ ...entry, status: "running" }));
        await runStations(
          plan.stations,
          probe,
          (station, result) =>
            patch(index, (entry) => ({
              ...entry,
              results: entry.results.map((previous, i) => (i === station ? result : previous)),
            })),
          () => cancelled,
        );
        if (cancelled) return;
        patch(index, (entry) => ({ ...entry, status: "done" }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plans, probe]);

  return React.useMemo(
    () => ({
      program,
      sections: plans.map((plan, index) => {
        // The first render after `program` changes still holds the PREVIOUS program's state: the
        // effect that resets it has not run yet. A leftover row of the wrong length would hand the
        // stage another section's results, so the plan's own starting point stands in.
        const held = state[index];
        const entry =
          held && held.results.length === plan.stations.length ? held : initialState(plan);
        return {
          section: plan.section,
          status: entry.status,
          walk: plan.parsed
            ? { parsed: plan.parsed, stations: plan.stations, results: entry.results }
            : null,
        };
      }),
    }),
    [program, plans, state],
  );
}

/** Whether the station can be played: present, loaded, and its sample came back. */
export function stationState(station: Station, result: StationResult | undefined): StationState {
  if (!station.present) return "absent";
  if (!result || result.status !== "done") return "loading";
  const sample = result.queries[station.id === "from" ? "src0.sample" : "sample"];
  return sample?.ok ? "ready" : "failed";
}
