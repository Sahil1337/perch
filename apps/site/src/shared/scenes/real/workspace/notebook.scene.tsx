// A notebook: field-notes.sql, one plain .sql file whose `-- %%` lines make three cells. The scene
// runs them in order with each cell's own Run button, and every result lands under its cell.

import { birdwatch } from "../../../replay";
import { CAMERA_MS, type Camera, DETAIL, type Focus, HOLD_MS } from "../../stage/camera";
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

/**
 * The same three queries written across short lines, for the phone's narrow notebook: whitespace is
 * all that differs, so each still runs as the recorded query does (`normaliseSql`).
 */
const PHONE_TEXT = `select count(*) as checklists,
       count(distinct observer_id)
         as observers
from checklists;
-- %%
select o.name,
       count(*) as checklists
from checklists c
join observers o
  on o.id = c.observer_id
group by o.name
order by checklists desc
limit 3;
-- %%
select extract(hour from seen_at)
         as hour,
       count(*) as sightings
from sightings
group by hour
order by sightings desc
limit 3;
`;

/** A whole cell: its label, its SQL, its run button and whatever it has returned so far. */
function wholeCell(camera: Camera, card: HTMLElement): Focus {
  const box = camera.box(card);
  return { x0: box.x - 12, y0: box.y - 12, x1: box.x + box.w + 12, y1: box.y + box.h + 12, fitWidth: true, reading: DETAIL };
}

/**
 * A phone's close-up of the notebook, laid out a phone's width wide: the whole file for a moment,
 * then cell by cell — the cell whole, its own run button pressed, and the result printing under it.
 * The loop ends on the last cell's result and opens wide again on the next pass.
 */
async function closeUpTour(context: SceneContext, camera: Camera, all: HTMLElement[]): Promise<void> {
  const { clock } = context;
  if (camera.scale >= 1) {
    camera.to(null, 900);
    await clock.sleep(900);
  }
  await clock.sleep(800);
  for (const [index, card] of all.entries()) {
    camera.to(wholeCell(camera, card), 900);
    await clock.sleep(900 + HOLD_MS);
    await runCell(context, index);
    await clock.sleep(300);
    // The cell has grown by its result: the frame follows it down.
    camera.to(wholeCell(camera, card), 700);
    await clock.sleep(700 + HOLD_MS + 500);
  }
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
  closeUpInput: {
    fixtures: birdwatch,
    open: [FILE],
    notebook: [FILE],
    files: { [FILE]: PHONE_TEXT },
    panels: { sidebarOpen: false, sidebarTab: "files", layout: splitLayout(42) },
  },

  async play(context) {
    const { clock, camera } = context;
    const all = await cards(context);
    if (camera?.closeUp) return closeUpTour(context, camera, all);
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

  // The first cell whole, with what it returned.
  rest: (camera, stage) => {
    const first = stage.querySelector<HTMLElement>("main article");
    return first ? wholeCell(camera, first) : null;
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
