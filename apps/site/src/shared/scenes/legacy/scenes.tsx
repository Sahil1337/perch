import type { SceneProps } from "../types";
import { LegacyScene, type LegacySceneDef } from "./legacy-scene";

// Each reserve is the element's own final box (window chrome included), so the page holds the
// space from first paint and nothing moves when the module, markup and fonts arrive.
const workspace = <div className="aspect-8/5" />;

const hero: LegacySceneDef = {
  module: "workspace",
  tag: "perch-workspace",
  attributes: { scene: "hero" },
  reserve: workspace,
};
const join: LegacySceneDef = {
  module: "workspace",
  tag: "perch-workspace",
  attributes: { scene: "join" },
  reserve: workspace,
};
const notebook: LegacySceneDef = {
  module: "workspace",
  tag: "perch-workspace",
  attributes: { scene: "notebook" },
  reserve: <div className="aspect-32/23" />,
};
const relations: LegacySceneDef = {
  module: "relations",
  tag: "perch-relations",
  reserve: <div className="aspect-16/11" />,
};
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

export const LegacyHeroScene = (props: SceneProps) => <LegacyScene def={hero} {...props} />;
export const LegacyCompletionScene = (props: SceneProps) => <LegacyScene def={join} {...props} />;
export const LegacyNotebookScene = (props: SceneProps) => <LegacyScene def={notebook} {...props} />;
export const LegacyRelationsScene = (props: SceneProps) => <LegacyScene def={relations} {...props} />;
export const LegacyWalkScene = (props: SceneProps) => <LegacyScene def={walk} {...props} />;
export const LegacyTerminalScene = (props: SceneProps) => <LegacyScene def={terminal} {...props} />;
