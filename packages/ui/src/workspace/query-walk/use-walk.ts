// Runs a walk's stations through `probe`, one station at a time, in order. Each batch is one probe
// call carrying its statements separated by `;`; the server runs them in order and stops at the
// first failure, so a completed statement is in `results` by position and the one after them is
// the one that threw. Results land per station as they arrive, so the player can start on the
// first station while the rest are still loading.
//
// `useProgram` runs the same loop once per section of a program, in the program's own order, so a
// section's dependencies have already been computed by the time it starts.

import type { RunRecord } from "@perch/protocol";
import * as React from "react";
import { boundPlan } from "./bound";
import { isSetOp, type ParsedSelect } from "./clauses";
import { messageOf, type QueryOutcome } from "./probe-outcome";
import type { Program, ResultOnly, Section } from "./program";
import {
  buildRecursionStations,
  buildResultStation,
  buildSetStations,
  buildStations,
  SAMPLE_ROWS,
  sampleId,
  type Station,
} from "./steps";

export type { QueryOutcome };

export type StationResult = {
  readonly status: "pending" | "loading" | "done";
  readonly queries: Readonly<Record<string, QueryOutcome>>;
};

export type WalkData = {
  /**
   * Null when the walk's stations are not about clauses of one SELECT, so there are none for a
   * scene or a sentence to reach for. Every builder that needs the parse checks the station id
   * first.
   *
   * Two things land here. A result-only section, whose body the clause slicer refused, has one
   * station and that station is the statement itself. A recursive CTE that could be split has
   * three, and they are three different STATEMENTS rather than three clauses of one — its own
   * `parsed` is the invented `select * from chain`, which describes none of them.
   */
  readonly parsed: ParsedSelect | null;
  /** The SQL this walk runs, which `parsed` cannot always be asked for. */
  readonly text: string;
  /**
   * What sort of thing a one-station walk is, for the narrator, which has a different lesson for a
   * VALUES list than for a bare `select 1`.
   *
   * Set only when `parsed` is null, but no longer whenever it is: a split recursive CTE has a null
   * parse and no `result`, because it is not a section the slicer refused — its stations carry
   * their own sentences instead. Read this as "a result-only section", not as "there is no parse".
   */
  readonly result: ResultOnly | null;
  readonly stations: readonly Station[];
  readonly results: readonly StationResult[];
};

export type StationState = "absent" | "loading" | "failed" | "ready";

export type Probe = (sql: string, options?: { maxRows?: number }) => Promise<RunRecord>;

const PENDING: StationResult = { status: "pending", queries: {} };

/**
 * Walks `stations` in order, reporting each one as its batches land.
 *
 * A plain function rather than the body of an effect, because a program runs it once per section:
 * the batch bookkeeping above is the subtle part of this file and two copies of it would drift.
 * `cancelled` is read fresh after every await so an unmounted walk stops mid-flight.
 */
async function runStations(
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
        for (const query of batch)
          queries[query.id] = { ok: false, error: message, skipped: false };
      }
      report(index, { status: "loading", queries: { ...queries } });
    }
    report(index, { status: "done", queries });
  }
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
  | "unwalkable"
  /**
   * Probing this section would change the database, so the walk shows it and never runs it. These
   * are the chapters that hold on purpose rather than for want of something to say.
   *
   * It covers the write itself AND everything downstream of it, which is the trap: a probe carries
   * its section's whole WITH prefix, so a `delete … returning *` in a WITH list would be re-run by
   * every station of every section after it, not just once by its own chapter.
   */
  | "writes";

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
  // Nothing that would change the database gets stations, and that is a wider net than the write
  // itself: a section downstream of a data-modifying CTE carries it in the WITH prefix of every
  // probe it builds, so running its walk would delete the same rows once per station.
  if (section.unsafeToProbe) return { section, parsed: null, stations: [], status: "writes" };

  // A result-only section is settled before anything else is asked about it: it has no parse, so
  // `boundPlan` has nothing to read.
  if (section.result !== null) {
    // Inside a per-row section there is no outer row bound yet, so running this once would answer a
    // question nobody asked. It holds with a note, the way any other unbindable section does.
    if (section.binding.kind === "bound") {
      return { section, parsed: null, stations: [], status: "held" };
    }
    return {
      section,
      parsed: null,
      stations: [buildResultStation(section.text)],
      status: "pending",
    };
  }

  // A recursive CTE whose two halves `program.ts` could prove: START, REPEAT and SETTLE rather than
  // the ten-station walk over `select * from chain`, which narrates a trivial SELECT and leaves the
  // recursion — the only interesting thing in the query — unexplained. `parsed` goes null with
  // them, which is what routes the stage through `resultScene`: each station is a whole statement
  // of its own, and the section's own parse describes none of the three.
  if (section.recursion !== null) {
    if (section.binding.kind === "bound") {
      return { section, parsed: null, stations: [], status: "held" };
    }
    return {
      section,
      parsed: null,
      stations: buildRecursionStations(
        section.recursion,
        section.prefix,
        section.recursion.name,
        section.text,
      ),
      status: "pending",
    };
  }
  // A set-operator chain gets one station per meeting of two results rather than the clause walk:
  // it has no clauses of its own, but "which rows survived, and from which side" is a question the
  // database can be asked directly, and `buildSetStations` asks it. Its `parsed` stays null for the
  // same reason a recursive CTE's does — each station is a statement, not a clause of one.
  if (section.parsed !== null && isSetOp(section.parsed)) {
    // Inside a per-row section there is no outer row bound yet, so these would answer a question
    // nobody asked. It holds with a note, as any other unbindable section does.
    if (section.binding.kind === "bound") {
      return { section, parsed: null, stations: [], status: "held" };
    }
    return {
      section,
      parsed: null,
      stations: buildSetStations(section.parsed),
      status: "pending",
    };
  }
  const parsed = section.parsed;
  const bound =
    section.binding.kind === "bound" && boundPlan(program, section).kind === "plan"
      ? "per-row"
      : "held";
  const status: SectionStatus =
    parsed === null ? "unwalkable" : section.binding.kind === "bound" ? bound : "pending";
  return {
    section,
    parsed,
    stations: parsed ? buildStations(parsed, program.dialect) : [],
    status,
  };
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
          // Stations, not the parse, are what decides whether there is a walk: a result-only
          // section has one station and no parse, and a set-op combine has a parse and no stations.
          walk:
            plan.stations.length > 0
              ? {
                  parsed: plan.parsed,
                  text: plan.section.text,
                  result: plan.section.result,
                  stations: plan.stations,
                  results: entry.results,
                }
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
  const sample = result.queries[sampleId(station)];
  return sample?.ok ? "ready" : "failed";
}
