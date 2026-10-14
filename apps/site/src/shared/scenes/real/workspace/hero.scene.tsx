// The hero: spring-migration.sql is open with its GROUP BY line still blank. The scene types it the
// way the app is used — `gro`, accept `group by`; ` s.`, accept `common_name` — runs the statement
// with ⌘↵ and holds on the 33 rows the database returned. Shown `usable`, it does that once and then
// leaves the editor, the file and the results to the visitor. Its beats (0 `gro`, 1 ` s.`, 2 ⌘↵) are
// what "Your turn" narrates beside the window.

import type { EditorView } from "@codemirror/view";
import { birdwatch, fixtureText } from "../../../replay";
import { CAMERA_MS } from "../../stage/camera";
import {
  pickCompletion,
  placeCaret,
  pressKey,
  scriptEditor,
  typeText,
  waitForCompletion,
  waitForEditor,
} from "../../stage/editor-driver";
import type { RealSceneProps } from "../../stage/lazy-scene";
import {
  RealScene,
  restOnResults,
  showRun,
  type SceneContext,
  type SceneScript,
  splitLayout,
  waitForRun,
} from "../../stage/real-scene";

const SPRING = "~/birdwatch/spring-migration.sql";
const RARE = "~/birdwatch/rare-sightings.sql";
const BUSIEST = "~/birdwatch/busiest-sites.sql";

const FULL = fixtureText(SPRING);
const BLANK = FULL.replace("group by s.common_name", "");
/** Line 6, the blank one, typed into. */
const LINE = 6;

/** Keeps the line in frame; a close-up's move finishes before the popup is read. */
async function follow(context: SceneContext, view: EditorView): Promise<void> {
  // The popup's box is drawn a frame or two after it opens, and a close-up frames all of it.
  if (context.camera?.closeUp) await context.clock.sleep(100);
  const moved = context.camera?.follow(context.camera.caretFocus(view));
  if (moved && context.camera?.closeUp) await context.clock.sleep(900);
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

    context.beat(0);
    await typeText(view, "gro", clock);
    if (await waitForCompletion(view, clock)) await follow(context, view);
    await pickCompletion(view, clock, (option) => option.label === "group by", { read: 520, step: 260 });
    await clock.sleep(260);

    context.beat(1);
    await typeText(view, " s.", clock);
    if (await waitForCompletion(view, clock)) await follow(context, view);
    await pickCompletion(view, clock, (option) => option.label === "common_name", {
      read: 1000,
      step: 300,
    });

    // A beat to read the line, long enough for autosave to land, then ⌘↵.
    await clock.sleep(1700);
    context.beat(2);
    await showRun(context, view);
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

  rest: restOnResults,

  anchors: (stage) => ({
    editorTabs: stage.querySelector<HTMLElement>("main [role='tablist']"),
    results: stage.querySelector<HTMLElement>("section[aria-label='Query results']"),
  }),
};

export default function HeroScene(props: RealSceneProps) {
  return <RealScene {...props} script={script} />;
}
