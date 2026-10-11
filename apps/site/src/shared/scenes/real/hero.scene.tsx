// The hero: spring-migration.sql is open with its GROUP BY line still blank. The scene types it the
// way the app is used — `gro`, accept `group by`; ` s.`, accept `common_name` — runs the statement
// with ⌘↵ and holds on the 33 rows the database returned. Shown `usable`, it does that once and then
// leaves the editor, the file and the results to the visitor.

import type { EditorView } from "@codemirror/view";
import { birdwatch, fixtureText } from "../../replay";
import { CAMERA_MS } from "../../replay/stage/camera";
import {
  pickCompletion,
  placeCaret,
  pressKey,
  scriptEditor,
  typeText,
  waitForCompletion,
  waitForEditor,
} from "../../replay/stage/editor-driver";
import type { RealSceneProps } from "../../replay/stage/lazy-scene";
import {
  RealScene,
  type SceneContext,
  type SceneScript,
  splitLayout,
  waitForRun,
} from "../../replay/stage/real-scene";

const SPRING = "~/birdwatch/spring-migration.sql";
const RARE = "~/birdwatch/rare-sightings.sql";
const BUSIEST = "~/birdwatch/busiest-sites.sql";

const FULL = fixtureText(SPRING);
const BLANK = FULL.replace("group by s.common_name", "");
/** Line 6, the blank one, typed into. */
const LINE = 6;

function follow(context: SceneContext, view: EditorView): void {
  context.camera?.follow(context.camera.caretFocus(view));
}

const script: SceneScript = {
  camera: "narrow",
  hold: 8500,
  input: {
    fixtures: birdwatch,
    open: [SPRING, RARE, BUSIEST],
    active: SPRING,
    files: { [SPRING]: BLANK },
    panels: { layout: splitLayout(42) },
  },

  async play(context) {
    const { clock, stage, camera } = context;
    const view = await waitForEditor(stage, clock);
    scriptEditor(view, true);
    placeCaret(view, LINE, 0);
    await clock.sleep(1200);
    if (camera) {
      camera.to(camera.caretFocus(view));
      await clock.sleep(CAMERA_MS);
    }

    await typeText(view, "gro", clock);
    if (await waitForCompletion(view, clock)) follow(context, view);
    await pickCompletion(view, clock, (option) => option.label === "group by", { read: 520, step: 260 });
    await clock.sleep(260);

    await typeText(view, " s.", clock);
    if (await waitForCompletion(view, clock)) follow(context, view);
    await pickCompletion(view, clock, (option) => option.label === "common_name", {
      read: 1000,
      step: 300,
    });

    // A beat to read the line, long enough for autosave to land, then ⌘↵.
    await clock.sleep(1700);
    camera?.to(null, 1100);
    const before = context.api().activeRun?.id;
    pressKey(view, "Mod-Enter");
    await waitForRun(context, before);
    await clock.sleep(1200);
  },

  async final(context) {
    const { clock, stage } = context;
    const view = await waitForEditor(stage, clock);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FULL } });
    placeCaret(view, LINE, "group by s.common_name".length);
    await context.api().save();
    pressKey(view, "Mod-Enter");
    await waitForRun(context);
  },

  anchors: (stage) => ({
    editorTabs: stage.querySelector<HTMLElement>("main [role='tablist']"),
    results: stage.querySelector<HTMLElement>("section[aria-label='Query results']"),
  }),
};

export default function HeroScene(props: RealSceneProps) {
  return <RealScene {...props} script={script} />;
}
