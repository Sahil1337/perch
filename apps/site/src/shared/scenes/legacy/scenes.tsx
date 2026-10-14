import type { SceneProps } from "../types";
import { LegacyScene, type LegacySceneDef } from "./legacy-scene";
import { closeUpWalk } from "./walk-close-up";

// Each reserve is the element's own final box (window chrome included), so the page holds the
// space from first paint and nothing moves when the module, markup and fonts arrive.
// The recording's window at 16:10, then the clause rail under it: 20px gap, a 27px chip, 8px pad.
// Below lg the window is walk-close-up.ts's crop, whose height legacy.css works out.
const walk: LegacySceneDef = {
  module: "walk",
  tag: "perch-walk",
  reserve: (
    <>
      <div className="flex flex-col max-lg:hidden">
        <div className="aspect-8/5" />
        <div className="h-13.75" />
      </div>
      <div data-perch-walk-reserve="" className="lg:hidden" />
    </>
  ),
  closeUp: closeUpWalk,
};
const terminal: LegacySceneDef = {
  module: "terminal",
  tag: "perch-terminal",
  reserve: <div data-perch-terminal-reserve="" />,
};

export const LegacyWalkScene = (props: SceneProps) => <LegacyScene def={walk} {...props} />;
export const LegacyTerminalScene = (props: SceneProps) => <LegacyScene def={terminal} {...props} />;
