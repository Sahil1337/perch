// A notebook: field-notes.sql, one plain .sql file whose `-- %%` lines make three cells. The scene
// runs them in order with each cell's own Run button, and every result lands under its cell.

import { birdwatch } from "../../../replay";
import { CAMERA_MS, type Camera, DETAIL, type Focus, HOLD_MS, PANES, ROWS } from "../../stage/camera";
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

/** A cell's SQL, read from the editor's left edge. */
function sqlFocus(camera: Camera, card: HTMLElement): Focus {
  const box = camera.box(card);
  const editor = card.querySelector(".cm-editor");
  const bottom = editor ? camera.box(editor).y + camera.box(editor).h : box.y + box.h;
  return { x0: box.x - 16, y0: box.y - 16, x1: box.x + 420, y1: bottom + 16, reading: DETAIL };
}

/** What a cell returned, under its SQL. */
function resultFocus(camera: Camera, card: HTMLElement): Focus {
  const box = camera.box(card);
  const editor = card.querySelector(".cm-editor");
  const top = editor ? camera.box(editor).y + camera.box(editor).h : box.y;
  return { x0: box.x - 16, y0: top - 40, x1: box.x + 420, y1: box.y + card.scrollHeight + 16, reading: ROWS };
}

/**
 * A phone's close-up of the notebook, from the wide shot of all three cells: in on a cell's SQL, its
 * run, down to what it returned, back out over that cell and the next, and in again. Wide at the end.
 */
async function closeUpTour(context: SceneContext, camera: Camera, all: HTMLElement[]): Promise<void> {
  const { clock } = context;
  for (const [index, card] of all.entries()) {
    camera.to(sqlFocus(camera, card), 900);
    await clock.sleep(900 + HOLD_MS);
    await runCell(context, index);
    await clock.sleep(400);
    camera.to(resultFocus(camera, card), 900);
    await clock.sleep(900 + HOLD_MS + 300);
    const next = all[index + 1];
    if (!next) break;
    // Back out over this cell and the next, so the move to it reads as down the same file.
    const from = camera.box(card);
    const to = camera.box(next);
    camera.to(
      { x0: from.x - 24, y0: from.y - 24, x1: from.x + from.w + 24, y1: to.y + to.h + 24, fitWidth: true, reading: PANES },
      900,
    );
    await clock.sleep(900 + 700);
  }
  camera.to(null, 1000);
  await clock.sleep(1000);
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
    if (camera?.closeUp) return closeUpTour(context, camera, all);
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

  // The last cell, its SQL and the top of what it returned.
  rest: (camera, stage) => {
    const last = [...stage.querySelectorAll<HTMLElement>("main article")].at(-1);
    return last ? resultFocus(camera, last) : null;
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
