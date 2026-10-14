// The recordings as typed data. Light, unlike ../index.ts: nothing here pulls in @perch/ui (the
// types are erased), so the page's own bundle can read the fixture.
import type { Row, StatementResult } from "@perch/protocol";
import type { Recording, ReplayFixtures } from "../types";
import birdwatchJson from "./birdwatch.json";

/** Recorded from a real Perch on the birdwatch database by apps/site/scripts/record.ts. */
export const birdwatch = birdwatchJson as unknown as ReplayFixtures;

/** A recorded file's content, as the workspace had it on disk. */
export function fixtureText(path: string, fixtures: ReplayFixtures = birdwatch): string {
  const file = fixtures.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`${path} was not recorded`);
  return file.content;
}

/** The first statement's result in the first birdwatch recording that `match`es. */
export function recordedResult(match: (recording: Recording) => boolean): StatementResult | undefined {
  return birdwatch.recordings.find(match)?.record.results?.[0];
}

/** Rows with every value as text. */
export const asText = (rows: Row[]): string[][] => rows.map((row) => row.map(String));
