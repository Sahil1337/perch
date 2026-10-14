// The real Relationship View — `SchemaDiagram` from @perch/ui — drawn from the schema a real Perch
// read off the birdwatch database. Focus and fit are the app's own code; what this module adds is
// only what a page needs around it: an entrance the first time the scene is in view, then a slow
// tour of `sightings` on a loop, and the anchors a page needs to put things on the cards. It is
// animation only: the window takes no pointer or key.

import { asyncLoading, type WorkspaceApi, WorkspaceProvider } from "@perch/ui";
import * as React from "react";
// Not exported by @perch/ui, which ships it only inside its modal dialog. The same file the package
// barrel resolves to, so it shares the barrel's WorkspaceProvider context.
import { SchemaDiagram } from "../../../../../../../packages/ui/src/workspace/schema-diagram/schema-diagram";
import { EASE_IN_OUT_CSS, EASE_OUT_CSS } from "../../../motion/easing";
import { birdwatch, useReplayWorkspace } from "../../../replay";
import type { SceneAnchors } from "../../types";
import type { SceneWindowParts } from "../kit/scene-window";
import { DialogFrame, DialogHost } from "../kit/dialog-host";
import { nativeCoordinates } from "./native-coordinates";
import "./relations.css";

const CARD_IN = 620;
const CARD_STAGGER = 60;
const WIRES_AT = 880;
const WIRE_DRAW = 720;
const WIRE_STAGGER = 110;
const PULSE_IN = 520;
const TOUR_TABLE = "sightings";
const TOUR_FIRST = 2600;
const TOUR_GAP = 9000;
const TOUR_LIT = 900;
const TOUR_HOLD = 3200;

/** SchemaDiagram's viewport: the pane under its toolbar. */
const viewportIn = (app: HTMLElement): HTMLElement | null => app.querySelector<HTMLElement>("header + div");

/** The cards, by table name: the canvas's div children, each headed by its name. */
function cardsIn(viewport: HTMLElement): Map<string, HTMLElement> {
  const cards = new Map<string, HTMLElement>();
  for (const card of viewport.querySelectorAll<HTMLElement>(":scope > div > div")) {
    const name = card.querySelector(":scope > div > span")?.textContent?.trim();
    if (name) cards.set(name, card);
  }
  return cards;
}

/** A timer that only counts while the scene is running, and can be called off. */
class Clock {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { remaining: number; since: number; resolve: (ran: boolean) => void } | null = null;
  private running = false;

  wait(ms: number): Promise<boolean> {
    this.cancel();
    return new Promise((resolve) => {
      this.pending = { remaining: ms, since: performance.now(), resolve };
      if (this.running) this.arm();
    });
  }

  run(running: boolean): void {
    if (running === this.running) return;
    this.running = running;
    const pending = this.pending;
    if (!pending) return;
    if (running) {
      pending.since = performance.now();
      this.arm();
    } else {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      pending.remaining -= performance.now() - pending.since;
    }
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending?.resolve(false);
    this.pending = null;
  }

  private arm(): void {
    const pending = this.pending;
    if (!pending) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.pending = null;
        pending.resolve(true);
      },
      Math.max(0, pending.remaining),
    );
  }
}

/**
 * A press on a card the way a pointer makes one, through the diagram's own handlers: down on the
 * card, up a beat later. The app toggles its focus on exactly this.
 */
async function pressCard(card: HTMLElement, at?: { x: number; y: number }): Promise<void> {
  const rect = card.getBoundingClientRect();
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: at?.x ?? rect.left + rect.width / 2,
    clientY: at?.y ?? rect.top + 12,
  };
  card.dispatchEvent(new PointerEvent("pointerdown", init));
  await new Promise((resolve) => setTimeout(resolve, 60));
  card.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
}

function hoverCard(card: HTMLElement, on: boolean, viewport: HTMLElement): void {
  card.dispatchEvent(
    new PointerEvent(on ? "pointerover" : "pointerout", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      relatedTarget: on ? null : viewport,
    }),
  );
}

type Phase = "idle" | "entrance" | "done";

export default function RelationsSceneInner({
  parts,
  visible,
  autoplay,
  reduced,
  onReady,
  onDone,
}: {
  parts: SceneWindowParts;
  visible: boolean;
  autoplay: boolean;
  reduced: boolean;
  onReady?: (anchors: SceneAnchors) => void;
  onDone?: () => void;
}): React.ReactElement {
  const { api } = useReplayWorkspace({ fixtures: birdwatch });
  const [ready, setReady] = React.useState(false);

  // The view remembers dragged cards per database in localStorage. A page's first picture should be
  // the recorded one every visit, so what an earlier visit left is cleared before the view reads it.
  const forget = React.useCallback(() => {
    if (!api.connectionId || !api.database) return;
    for (const mode of ["all", "keys"]) {
      try {
        localStorage.removeItem(`perch:diagram:${api.connectionId}:${api.database}:${mode}`);
      } catch {
        // Storage can be off; then there is nothing remembered either.
      }
    }
  }, [api.connectionId, api.database]);
  React.useLayoutEffect(forget, [forget]);

  // The schema is held back until the viewport speaks in window pixels (see `nativeCoordinates`):
  // the view fits itself to the viewport the moment it has tables, and must measure the real size.
  const gated = React.useMemo<WorkspaceApi>(() => ({ ...api, schema: asyncLoading }), [api]);

  const callbacks = React.useRef({ onReady, onDone });
  React.useLayoutEffect(() => {
    callbacks.current = { onReady, onDone };
  });

  const live = React.useRef({
    phase: "idle" as Phase,
    visible,
    animations: new Set<Animation>(),
    clock: new Clock(),
    token: 0,
    tourHover: null as HTMLElement | null,
  });
  React.useLayoutEffect(() => {
    live.current.visible = visible;
  }, [visible]);
  const motion = autoplay && !reduced;

  const tour = React.useCallback(
    async (token: number): Promise<void> => {
      const state = live.current;
      const going = (): boolean => token === state.token;
      let gap = TOUR_FIRST;
      while (going()) {
        if (!(await state.clock.wait(gap)) || !going()) return;
        gap = TOUR_GAP;
        const viewport = viewportIn(parts.app);
        const card = viewport ? cardsIn(viewport).get(TOUR_TABLE) : undefined;
        if (!viewport || !card || viewport.querySelector("[data-selected]")) continue;
        state.tourHover = card;
        hoverCard(card, true, viewport);
        if (!(await state.clock.wait(TOUR_LIT)) || !going()) return;
        hoverCard(card, false, viewport);
        state.tourHover = null;
        await pressCard(card);
        if (!(await state.clock.wait(TOUR_HOLD)) || !going()) return;
        if (card.hasAttribute("data-selected")) await pressCard(card);
      }
    },
    [parts.app],
  );

  const finish = React.useCallback(
    (token: number) => {
      const state = live.current;
      if (token !== state.token) return;
      state.phase = "done";
      callbacks.current.onDone?.();
      if (motion) void tour(token);
    },
    [motion, tour],
  );

  const entrance = React.useCallback(
    async (token: number): Promise<void> => {
      const state = live.current;
      const viewport = viewportIn(parts.app);
      if (!viewport) return;
      state.phase = "entrance";
      const track = (animation: Animation): Promise<unknown> => {
        state.animations.add(animation);
        if (!state.visible) animation.pause();
        return animation.finished
          .catch(() => undefined)
          .finally(() => state.animations.delete(animation));
      };
      const position = (card: HTMLElement): [number, number] => [
        Number.parseFloat(card.style.getPropertyValue("--x")) || 0,
        Number.parseFloat(card.style.getPropertyValue("--y")) || 0,
      ];
      const cards = [...cardsIn(viewport).values()].sort((a, b) => {
        const [ax, ay] = position(a);
        const [bx, by] = position(b);
        return ax - bx || ay - by;
      });
      delete viewport.dataset.scenePre;

      const arrivals = cards.map((card, index) =>
        track(
          card.animate(
            [
              { opacity: 0, transform: "translateY(10px) scale(0.985)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: CARD_IN, delay: index * CARD_STAGGER, easing: EASE_OUT_CSS, fill: "backwards" },
          ),
        ),
      );

      // Each wire draws from the key it points at back to the column that holds it: parent to child.
      const wires = [...viewport.querySelectorAll<SVGGElement>(":scope > div > svg > g")].map((group) => {
        const paths = [...group.querySelectorAll<SVGPathElement>("path")];
        const line = paths[0]!;
        const end = line.getPointAtLength(line.getTotalLength());
        return {
          line,
          pulse: paths.length === 4 ? paths[1]! : null,
          crow: paths[paths.length - 2]!,
          bar: paths[paths.length - 1]!,
          end,
          start: line.getPointAtLength(0),
        };
      });
      wires.sort((a, b) => a.end.x - b.end.x || a.end.y - b.end.y || a.start.y - b.start.y);
      const drawn = wires.map((wire, index) => {
        const at = WIRES_AT + index * WIRE_STAGGER;
        wire.line.setAttribute("pathLength", "1");
        const done = [
          track(
            wire.line.animate(
              [
                { strokeDasharray: "1 2", strokeDashoffset: -1 },
                { strokeDasharray: "1 2", strokeDashoffset: 0 },
              ],
              { duration: WIRE_DRAW, delay: at, easing: EASE_IN_OUT_CSS, fill: "backwards" },
            ),
          ),
          track(wire.bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: at, fill: "backwards" })),
          track(
            wire.crow.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 240,
              delay: at + WIRE_DRAW - 120,
              fill: "backwards",
            }),
          ),
        ];
        if (wire.pulse) {
          done.push(
            track(
              wire.pulse.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration: PULSE_IN,
                delay: at + WIRE_DRAW,
                easing: EASE_OUT_CSS,
                fill: "backwards",
              }),
            ),
          );
        }
        return Promise.all(done).finally(() => wire.line.removeAttribute("pathLength"));
      });

      await Promise.all([...arrivals, ...drawn]);
      finish(token);
    },
    [finish, parts.app],
  );

  // The view is up: anchors for the page, and on the way out, everything the beat started is called off.
  React.useLayoutEffect(() => {
    if (!ready) return;
    const state = live.current;
    const viewport = viewportIn(parts.app);
    if (viewport) {
      const cards: Record<string, HTMLElement> = Object.fromEntries(cardsIn(viewport));
      callbacks.current.onReady?.({ window: parts.window, titlebar: parts.titlebar, cards });
    }
    return () => {
      state.token += 1;
      state.clock.cancel();
      for (const animation of [...state.animations]) animation.cancel();
      state.animations.clear();
      state.phase = "idle";
      state.tourHover = null;
      const current = viewportIn(parts.app);
      if (current && motion) current.dataset.scenePre = "";
    };
  }, [motion, parts.app, parts.titlebar, parts.window, ready]);

  // Plays the entrance the first time the view is in sight, holds everything while it is not.
  React.useEffect(() => {
    if (!ready) return;
    const state = live.current;
    for (const animation of state.animations) {
      if (visible) animation.play();
      else animation.pause();
    }
    state.clock.run(visible);
    if (state.phase !== "idle" || !visible) return;
    if (!motion) {
      const viewport = viewportIn(parts.app);
      if (viewport) delete viewport.dataset.scenePre;
      finish(state.token);
      return;
    }
    void entrance(state.token);
  }, [entrance, finish, motion, parts.app, ready, visible]);

  return (
    <DialogHost container={parts.app}>
      <DialogFrame>
        <WorkspaceProvider value={ready ? api : gated}>
          <SchemaDiagram />
          <Patch app={parts.app} onPatched={() => setReady(true)} pre={motion} />
        </WorkspaceProvider>
      </DialogFrame>
    </DialogHost>
  );
}

/**
 * Mounted after SchemaDiagram, so its layout effect runs once the diagram's viewport exists and
 * before the diagram has a schema to fit: the moment to put the viewport in window pixels.
 */
function Patch({
  app,
  pre,
  onPatched,
}: {
  app: HTMLElement;
  pre: boolean;
  onPatched: () => void;
}): null {
  // Read once, when the view mounts: whether it opens empty, waiting for its entrance.
  const opensEmpty = React.useRef(pre);
  const patched = React.useRef(onPatched);
  React.useLayoutEffect(() => {
    const viewport = viewportIn(app);
    if (!viewport) return;
    if (opensEmpty.current) viewport.dataset.scenePre = "";
    // The tour's presses are synthetic and have no live pointer to capture.
    viewport.setPointerCapture = function setPointerCapture(this: HTMLElement, pointerId: number): void {
      try {
        Element.prototype.setPointerCapture.call(this, pointerId);
      } catch {
        // NotFoundError: nothing to capture.
      }
    };
    const stop = nativeCoordinates(app, () => viewport);
    patched.current();
    return stop;
  }, [app]);
  return null;
}
