// The replayed workspace. Heavy: this pulls in @perch/ui (CodeMirror and every workspace surface),
// so only import it from a module that is itself loaded lazily — see stage/lazy-scene.tsx.
import birdwatchJson from "./fixtures/birdwatch.json";
import type { ReplayFixtures } from "./types";

export { createReplayWorkspace, REPLAY_NOTICE } from "./store";
export { useReplayWorkspace } from "./use-replay";
export { normaliseSql } from "./normalise";
export type { FixtureFile, Recording, ReplayFixtures, ReplayInput, ReplayWorkspace } from "./types";

/** Recorded from a real Perch on the birdwatch database by apps/site/scripts/record.ts. */
export const birdwatch = birdwatchJson as unknown as ReplayFixtures;

/** A recorded file's content, as the workspace had it on disk. */
export function fixtureText(path: string, fixtures: ReplayFixtures = birdwatch): string {
  const file = fixtures.files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`${path} was not recorded`);
  return file.content;
}
