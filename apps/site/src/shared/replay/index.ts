// The replayed workspace. Heavy: this pulls in @perch/ui (CodeMirror and every workspace surface),
// so only import it from a module that is itself loaded lazily — see scenes/stage/lazy-scene.tsx.
export { createReplayWorkspace, REPLAY_NOTICE } from "./store";
export { useReplayWorkspace } from "./use-replay";
export { normaliseSql } from "./normalise";
export type { FixtureFile, Recording, ReplayFixtures, ReplayInput, ReplayWorkspace } from "./types";
export { birdwatch, fixtureText } from "./fixtures";
