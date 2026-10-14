// A notebook: field-notes.sql, one plain .sql file whose `-- %%` lines make three cells. The scene
// runs them in order with each cell's own Run button, and every result lands under its cell.

import { birdwatch } from "../../../replay";
import { CAMERA_MS } from "../../stage/camera";
import type { RealSceneProps } from "../../stage/lazy-scene";
import {
  NARROW_WIDTH,
  RealScene,
  type SceneContext,
  type SceneScript,
  splitLayout,
  waitForRun,
} from "../../stage/real-scene";

const FILE = "~/birdwatch/field-notes.sql";

async function cards(context: SceneContext): Promise<HTMLElement[]> {
  for (;;) {
    const found = [...context.stage.querySelectorAll<HTMLElement>("main article")];
    if (found.length > 0 && found.every((card) => card.querySelector(".cm-editor"))) return found;
    await context.clock.sleep(50);
  }
}

async function runCell(context: SceneContext, index: number): Promise<void> {
  const button = context.stage.querySelector<HTMLButtonElement>(
    `main article button[aria-label="Run cell ${index + 1}"]`,
  );
  if (!button) return;
  const before = context.api().activeRun?.id;
  button.click();
  await waitForRun(context, before);
}

const script: SceneScript = {
  camera: "always",
  hold: 8500,
  input: {
    fixtures: birdwatch,
    open: [FILE],
    notebook: [FILE],
    panels: { sidebarTab: "files", layout: splitLayout(42) },
  },

  async play(context) {
    const { clock, camera } = context;
    const all = await cards(context);
    await clock.sleep(1200);
    for (const [index, card] of all.entries()) {
      // Narrow, a whole card is too small to read: hold its SQL, then cross to the numbers.
      const narrow = camera !== null && context.frameWidth() < NARROW_WIDTH;
      if (camera) {
        camera.to(camera.cardFocus(card, narrow ? "left" : "all"));
        await clock.sleep(index === 0 ? CAMERA_MS : 750);
      }
      await clock.sleep(index === 0 ? 400 : 300);
      await runCell(context, index);
      await clock.sleep(camera ? 1100 : 600);
      if (camera && narrow) {
        camera.to(camera.cardFocus(card, "right"), 900);
        await clock.sleep(1600);
      }
    }
    camera?.to(null, 1100);
    await clock.sleep(1100);
  },

  async final(context) {
    const all = await cards(context);
    for (const index of all.keys()) await runCell(context, index);
  },

  anchors: (stage) => ({
    runAll: [...stage.querySelectorAll<HTMLElement>("main button")].find((button) =>
      button.textContent?.includes("Run all"),
    ),
    cells: stage.querySelector<HTMLElement>("main article"),
  }),
};

export default function NotebookScene(props: RealSceneProps) {
  return <RealScene {...props} script={script} />;
}
