"use client";

// Runs a walk's stations through `probe`, one station at a time, in order. Each batch is one probe
// call carrying its statements separated by `;`; the server runs them in order and stops at the
// first failure, so a completed statement is in `results` by position and the one after them is
// the one that threw. Results land per station as they arrive, so the player can start on the
// first station while the rest are still loading.

import type { RunRecord, StatementResult } from "@perch/protocol";
import * as React from "react";
import type { ParsedSelect } from "./clauses";
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

export function useWalk(parsed: ParsedSelect, probe: Probe): WalkData {
  const stations = React.useMemo(() => buildStations(parsed), [parsed]);
  const [results, setResults] = React.useState<readonly StationResult[]>(() =>
    stations.map(() => PENDING),
  );

  React.useEffect(() => {
    let cancelled = false;
    setResults(stations.map(() => PENDING));
    const update = (index: number, result: StationResult): void => {
      if (cancelled) return;
      setResults((previous) => previous.map((entry, i) => (i === index ? result : entry)));
    };

    void (async () => {
      for (const [index, station] of stations.entries()) {
        if (!station.present) continue;
        update(index, { status: "loading", queries: {} });
        const queries: Record<string, QueryOutcome> = {};
        for (const batch of station.batches) {
          try {
            const record = await probe(batch.map((query) => query.sql).join(";\n"), {
              maxRows: SAMPLE_ROWS,
            });
            if (cancelled) return;
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
            if (cancelled) return;
            const message = messageOf(error);
            for (const query of batch) queries[query.id] = { ok: false, error: message, skipped: false };
          }
          update(index, { status: "loading", queries: { ...queries } });
        }
        update(index, { status: "done", queries });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stations, probe]);

  return { parsed, stations, results };
}

/** Whether the station can be played: present, loaded, and its sample came back. */
export function stationState(station: Station, result: StationResult | undefined): StationState {
  if (!station.present) return "absent";
  if (!result || result.status !== "done") return "loading";
  const sample = result.queries[station.id === "from" ? "src0.sample" : "sample"];
  return sample?.ok ? "ready" : "failed";
}
