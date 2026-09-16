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
import { boundPlan } from "./bound";
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
 * Three of these are phases of loading and three are not. `per-row` and `held` are both correlated
 * sections, and the difference between them is whether there is anything to bind them TO: a
 * `per-row` section has a settled table of outer rows, so `BoundSection` probes it a row at a time
 * and owns its own playback; a `held` one is bound to a section that is itself per-row, so its outer
 * rows do not exist until a row of that one has been picked. Neither is ever run by the loop below —
 * running a correlated query once with nothing bound to its columns would print an answer that is
 * true of no row.
 */
export type SectionStatus =
  | "pending"
  | "running"
  | "done"
  | "per-row"
  | "held"
  | "unwalkable";

/** Whether the section runs once per row of another, and so is not stepped through station by
 *  station. Both kinds hand the stage to a view of their own instead of to the station walk. */
export function runsPerRow(status: SectionStatus): boolean {
  return status === "per-row" || status === "held";
}

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

/**
 * The results, and the plans they were produced from.
 *
 * The plans are carried alongside because they are the only thing that tells one program's answers
 * from another's. Two unrelated sections routinely have the same number of stations — nine is the
 * common case — so a row's LENGTH settles nothing, and a program swap would otherwise hand the
 * stage the previous program's rows under the new program's labels.
 */
type ProgramState = {
  readonly plans: readonly SectionPlan[];
  readonly entries: readonly SectionState[];
};

/**
 * A section's plan, which needs the whole program rather than the section alone: whether a bound
 * section can actually be bound depends on what its OUTER section is, and that is a lookup.
 */
function planSection(program: Program, section: Section): SectionPlan {
  const parsed = isSetOp(section.parsed) ? null : section.parsed;
  const bound =
    section.binding.kind === "bound" && boundPlan(program, section).kind === "plan"
      ? "per-row"
      : "held";
  const status: SectionStatus =
    parsed === null ? "unwalkable" : section.binding.kind === "bound" ? bound : "pending";
  return { section, parsed, stations: parsed ? buildStations(parsed) : [], status };
}

const initialState = (plan: SectionPlan): SectionState => ({
  status: plan.status,
  results: plan.stations.map(() => PENDING),
});

export function useProgram(program: Program, probe: Probe): ProgramData {
  const plans = React.useMemo(
    () => program.sections.map((section) => planSection(program, section)),
    [program],
  );
  const [state, setState] = React.useState<ProgramState>(() => ({
    plans,
    entries: plans.map(initialState),
  }));

  // Reset during render rather than in an effect, so no frame is ever painted with the previous
  // program's results. An effect runs after the paint, which is one frame of a section showing
  // another section's rows — and the rows are the whole point of this screen.
  const entries = state.plans === plans ? state.entries : plans.map(initialState);
  if (state.plans !== plans) setState({ plans, entries });

  React.useEffect(() => {
    let cancelled = false;
    const patch = (index: number, change: (entry: SectionState) => SectionState): void => {
      if (cancelled) return;
      setState((previous) =>
        // A report that lands after the program changed belongs to the walk that has just been
        // cancelled; writing it into the new program's row would corrupt it.
        previous.plans !== plans
          ? previous
          : {
              plans,
              entries: previous.entries.map((entry, i) => (i === index ? change(entry) : entry)),
            },
      );
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
        const entry = entries[index] ?? initialState(plan);
        return {
          section: plan.section,
          status: entry.status,
          walk: plan.parsed
            ? { parsed: plan.parsed, stations: plan.stations, results: entry.results }
            : null,
        };
      }),
    }),
    [program, plans, entries],
  );
}

/** Whether the station can be played: present, loaded, and its sample came back. */
export function stationState(station: Station, result: StationResult | undefined): StationState {
  if (!station.present) return "absent";
  if (!result || result.status !== "done") return "loading";
  const sample = result.queries[station.id === "from" ? "src0.sample" : "sample"];
  return sample?.ok ? "ready" : "failed";
}
