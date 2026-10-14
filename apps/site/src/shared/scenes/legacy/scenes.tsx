import type { SceneProps } from "../types";
import { LegacyScene, type LegacySceneDef } from "./legacy-scene";

// Each reserve is the element's own final box (window chrome included), so the page holds the
// space from first paint and nothing moves when the module, markup and fonts arrive.
// The recording's window at 16:10, then the clause rail under it: 20px gap, a 27px chip, 8px pad.
const walk: LegacySceneDef = {
  module: "walk",
  tag: "perch-walk",
  reserve: (
    <div className="flex flex-col">
      <div className="aspect-8/5" />
      <div className="h-13.75" />
    </div>
  ),
};
const terminal: LegacySceneDef = {
  module: "terminal",
  tag: "perch-terminal",
  reserve: <div data-perch-terminal-reserve="" />,
};

export const LegacyWalkScene = (props: SceneProps) => <LegacyScene def={walk} {...props} />;
export const LegacyTerminalScene = (props: SceneProps) => <LegacyScene def={terminal} {...props} />;
