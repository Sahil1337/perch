import type { Bird } from "../../../../shared/bird";
import type { Point } from "../../math";
import { QUERY } from "../data";
import type { KeyId } from "../keymap";
import type { Beat } from "../overlay/query";
import type { Sculpture } from "../sculpture/sculpture";
import type { Run } from "./run";

export type Stage = {
  bird: Bird | null;
  sculpture: Sculpture;
  anchor: (id: KeyId) => HTMLElement | null;
  set: (next: Partial<Beat>) => void;
  /** The menu's box, for the bird to glance at. */
  menu: () => Element | null;
  query: () => Element | null;
  stomp: () => Promise<void>;
};

const centre = (el: Element): Point => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * The bird's hop onto a key; the key goes down when it lands, and holds a little lower while the
 * bird stands on it. Without a bird to fly (none yet, or keeping still) the key is only pressed.
 */
export async function hop(
  stage: Stage,
  id: KeyId,
  options: { run: Run; pace?: number; force?: number; look?: number },
) {
  const { bird, sculpture } = stage;
  const { run } = options;
  const el = stage.anchor(id);
  if (!el) return;
  const flies = bird !== null && !bird.reducedMotion;
  if (flies) {
    if (options.look) {
      const c = centre(el);
      bird.lookAt({ x: c.x, y: c.y - 10 });
      await run.wait(options.look);
    }
    const from = bird.position?.x ?? 0;
    const to = centre(el).x;
    sculpture.setOccupied(null);
    await bird.perchOn(el, { at: 0.5, facing: to >= from ? "right" : "left", pace: options.pace ?? 2 });
  } else await run.wait(260);
  run.check();
  if (flies) sculpture.setOccupied(id);
  sculpture.press(id, options.force ?? 1);
}

/** The intro: the bird types `join sp`, takes the completion, and runs the query on return. */
export async function intro(stage: Stage, run: Run) {
  const { bird, sculpture, set } = stage;
  const type = (n: number) => set({ typed: n });
  await run.wait(60);

  // The bird is already on J when it shows, rather than flying in from off screen: the intro starts
  // as soon as the bird is here.
  const j = stage.anchor("j");
  if (bird && j && !bird.reducedMotion) {
    await bird.appear(j, { at: 0.5, facing: "left" });
    await run.wait(320);
    bird.hop();
    await run.wait(140);
    sculpture.setOccupied("j");
    sculpture.press("j");
  } else await hop(stage, "j", { run });
  type(1);

  const letters: KeyId[] = ["o", "i", "n"];
  for (const [i, id] of letters.entries()) {
    await hop(stage, id, { run, look: i === 0 ? 80 : 0, pace: 3 });
    type(2 + i);
  }
  await hop(stage, "space", { run, pace: 2.2 });
  type(5);
  // the hunt: a look along the middle row before the prefix
  await hop(stage, "s", { run, look: 140, pace: 2.6 });
  type(6);
  await hop(stage, "p", { run, pace: 3 });
  type(7);

  await run.wait(100);
  set({ menu: true });
  await run.wait(80);
  const menu = stage.menu();
  if (bird && menu) bird.lookAt(centre(menu));
  await run.wait(260);

  await hop(stage, "tab", { run, pace: 2.2 });
  set({ menu: false, completed: true });
  await run.wait(100);

  const query = stage.query();
  if (bird && query) bird.lookAt(centre(query));
  for (let n = 1; n <= QUERY.on.length; n++) {
    set({ on: n, fk: true });
    await run.wait(16);
  }
  await run.wait(200);
  set({ fk: false });

  // The giant key: a crouch, a flutter, and one long jump across the sculpture.
  const ret = stage.anchor("return");
  const tab = stage.anchor("tab");
  if (bird && ret && tab && !bird.reducedMotion) {
    bird.lookAt(centre(ret));
    await run.wait(100);
    bird.hop();
    await run.wait(200);
    bird.flutter();
    const a = centre(tab);
    const b = centre(ret);
    sculpture.setOccupied(null);
    await bird.perchOn(ret, {
      at: 0.5,
      facing: "right",
      pace: 3,
      via: [{ el: ret, x: (a.x - b.x) * 0.5, y: -Math.max(110, Math.abs(a.x - b.x) * 0.24) }],
    });
    run.check();
    sculpture.setOccupied("return");
  } else await hop(stage, "return", { run });
  set({ ran: true });
  await stage.stomp();
}
