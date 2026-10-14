// Completion that reads the query: sightings-by-site.sql with both JOINs still to write. `join`
// and ⌃Space lists the tables a foreign key reaches from `sightings` first; `on` and ⌃Space offers
// the join condition written out from that key. Then the second join the same way, a column from a
// joined table back in the select list, and a run.

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
  type SceneContext,
  type SceneScript,
  splitLayout,
  waitForRun,
} from "../../stage/real-scene";

const FILE = "~/birdwatch/sightings-by-site.sql";
const FULL = fixtureText(FILE);
const BLANK = FULL.replace("t.name, sum", "sum")
  .replace("join checklists c on g.checklist_id = c.id", "")
  .replace("join sites t on c.site_id = t.id", "");

function follow(context: SceneContext, view: EditorView): void {
  context.camera?.follow(context.camera.caretFocus(view));
}

/** ⌃Space, a long look at what the app ranked first, then the option the scene wants. */
async function ask(
  context: SceneContext,
  view: EditorView,
  want: (label: string, detail: string | undefined) => boolean,
  read: number,
): Promise<void> {
  pressKey(view, "Ctrl-Space");
  if (await waitForCompletion(view, context.clock)) follow(context, view);
  await pickCompletion(view, context.clock, (option) => want(option.label, option.detail), {
    read,
    step: 420,
  });
}

const script: SceneScript = {
  camera: "always",
  hold: 8000,
  input: {
    fixtures: birdwatch,
    open: [FILE],
    files: { [FILE]: BLANK },
    panels: { layout: splitLayout(42) },
  },

  async play(context) {
    const { clock, stage, camera } = context;
    const view = await waitForEditor(stage, clock);
    scriptEditor(view, true);
    placeCaret(view, 4, 0);
    await clock.sleep(1000);
    if (camera) {
      camera.to(camera.caretFocus(view));
      await clock.sleep(CAMERA_MS);
    }

    await typeText(view, "jo", clock);
    await pickCompletion(view, clock, (option) => option.label === "join", { read: 420, step: 260 });
    await typeText(view, " ", clock);
    // The tables, the ones a foreign key reaches from `sightings` first.
    await ask(context, view, (label) => label === "checklists", 1700);
    await typeText(view, " c on ", clock);
    // The join condition, written out from the foreign key.
    await ask(context, view, (label) => label === "g.checklist_id = c.id", 1700);
    await clock.sleep(500);

    pressKey(view, "ArrowDown");
    await clock.sleep(300);
    follow(context, view);
    await typeText(view, "join ", clock);
    await ask(context, view, (label) => label === "sites", 1000);
    await typeText(view, " t on ", clock);
    await ask(context, view, (label) => label === "c.site_id = t.id", 1300);
    await clock.sleep(600);

    // Back to the select list: only the joined tables' columns are offered.
    placeCaret(view, 2, "select ".length);
    follow(context, view);
    await clock.sleep(500);
    await typeText(view, "na", clock);
    if (await waitForCompletion(view, clock)) follow(context, view);
    await pickCompletion(view, clock, (option) => (option.displayLabel ?? option.label) === "t.name", {
      read: 1000,
      step: 300,
    });
    await typeText(view, ", ", clock);

    await clock.sleep(1500);
    camera?.to(null, 1100);
    const before = context.api().activeRun?.id;
    pressKey(view, "Mod-Enter");
    await waitForRun(context, before);
    await clock.sleep(1200);
  },

  async final(context) {
    const view = await waitForEditor(context.stage, context.clock);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FULL } });
    placeCaret(view, 2, "select t.name, ".length);
    await context.api().save();
    pressKey(view, "Mod-Enter");
    await waitForRun(context);
  },

  rest: restOnResults,

  anchors: (stage) => ({
    results: stage.querySelector<HTMLElement>("section[aria-label='Query results']"),
  }),
};

export default function CompletionScene(props: RealSceneProps) {
  return <RealScene {...props} script={script} />;
}
