import type { SceneProps } from "../types";
import { LegacyScene, type LegacySceneDef } from "./legacy-scene";
import { panWalk } from "./walk-phone";

// Each reserve is the element's own final box (window chrome included), so the page holds the
// space from first paint and nothing moves when the module, markup and fonts arrive.
// The recording's window at 16:10, then the clause rail under it: 20px gap, a 27px chip, 8px pad.
// Below md the phone cut's window instead, framed by walk-phone.ts; legacy.css works out its height.
const walk: LegacySceneDef = {
  module: "walk",
  tag: "perch-walk",
  reserve: (
    <>
      <div className="flex flex-col max-md:hidden">
        <div className="aspect-8/5" />
        <div className="h-13.75" />
      </div>
      <div data-perch-walk-reserve="" className="md:hidden" />
    </>
  ),
  phone: { attribute: "variant", value: "phone", frame: panWalk },
};
const terminal: LegacySceneDef = {
  module: "terminal",
  tag: "perch-terminal",
  reserve: <div data-perch-terminal-reserve="" />,
};

export const LegacyWalkScene = (props: SceneProps) => <LegacyScene def={walk} {...props} />;
export const LegacyTerminalScene = (props: SceneProps) => <LegacyScene def={terminal} {...props} />;
