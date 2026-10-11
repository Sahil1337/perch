// The heavy half of the Query Walk scene: the walk @perch/ui ships, on probes recorded from a real
// Perch and Postgres, played by pressing its own controls the way a reader would. Imported only
// by walk.tsx, lazily, once the window comes near.

import { WorkspaceProvider, type WorkspaceApi } from "@perch/ui";
import * as React from "react";
// @perch/ui exports only the modal dialog around the walk, which would lock the page's scroll. This
// is the file its barrel resolves to, so the two share one copy of every React context.
import { QueryWalk } from "../../../../../../packages/ui/src/workspace/query-walk/query-walk";
import { birdwatch, normaliseSql, type Recording, useReplayWorkspace } from "../../replay";
import walkJson from "../../replay/fixtures/walk.json";
import type { SceneAnchors, SceneProps } from "../types";
import { DialogFrame, DialogHost } from "./relations-walk-host";
import type { SceneWindowParts } from "./relations-walk-kit";
import { stationButtons } from "./walk-rail";

/** The statement recorded by scripts/record-walk.ts; its probes are in fixtures/walk.json. */
const WALK_SQL = `select f.name as family, count(*) as migrants
from species s
join families f on f.id = s.family_id
where s.migrant
group by f.name
having count(*) > 1
order by migrants desc, family
limit 4;`;

const walkRecordings = walkJson as unknown as Recording[];
const REPLAY = { fixtures: birdwatch, extraRecordings: walkRecordings };

/** The answer stays up this long before the walk starts again from FROM. */
const REST_MS = 5000;
/** A press shows up on the walk's next render; nothing else is pressed until it has. */
const LANDING_MS = 250;
/** After the walk's own X, how long the window stays empty before a fresh walk opens. */
const CLOSED_MS = 900;

type Mode = "loop" | "final";
type Live = { visible: boolean; closing: boolean };

type Controls = {
  readonly toolbar: Element;
  readonly stations: HTMLButtonElement[];
  readonly play: HTMLButtonElement;
  readonly forward: HTMLButtonElement;
};

function controlsIn(app: HTMLElement): Controls | null {
  const toolbar = app.querySelector('[role="toolbar"][aria-label="Playback"]');
  if (!toolbar) return null;
  const [, play, forward] = toolbar.querySelectorAll<HTMLButtonElement>("button");
  const stations = stationButtons(app);
  return play && forward && stations.length > 0 ? { toolbar, stations, play, forward } : null;
}

const labelOf = (button: Element): string => button.getAttribute("aria-label") ?? "";
const loading = (button: Element): boolean => labelOf(button).endsWith(", loading");
const playable = (button: Element): boolean => !/, (not in this query|failed)$/.test(labelOf(button));

/**
 * Plays the walk through its own buttons. Everything it knows about the walk it reads back from
 * the walk's DOM — the Play/Pause label, a disabled Step forward at the end, the lit station — so it
 * cannot disagree with what is on screen, and the visitor's presses and its own go through the same
 * code. It acts at most once per landed press.
 */
class Pilot {
  #walk: Element | null = null;
  #seized = false;
  #started = false;
  #finished = false;
  #wasPlaying = false;
  #wasVisible = false;
  #pausedByScene = false;
  #rest: { left: number; since: number; timer: ReturnType<typeof setTimeout> | undefined } | null =
    null;
  #restDue = false;
  #quietUntil = 0;
  #wake: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly app: HTMLElement,
    private readonly mode: Mode,
    private readonly live: React.RefObject<Live>,
    private readonly done: () => void,
  ) {}

  dispose(): void {
    clearTimeout(this.#wake);
    if (this.#rest) clearTimeout(this.#rest.timer);
    this.#rest = null;
  }

  tick = (): void => {
    clearTimeout(this.#wake);
    const controls = controlsIn(this.app);
    if (!controls) return;
    const live = this.live.current;
    if (controls.toolbar !== this.#walk) this.#fresh(controls.toolbar, live);
    const playing = controls.play.getAttribute("aria-label") === "Pause";
    const atEnd = controls.forward.disabled;

    if (this.#wasPlaying && !playing && atEnd) {
      this.done();
      if (this.mode === "loop") this.#rest = { left: REST_MS, since: 0, timer: undefined };
    }
    this.#wasPlaying = playing;
    this.#keepRest(live);

    const wait = this.#quietUntil - performance.now();
    if (wait > 0) {
      this.#wake = setTimeout(this.tick, wait);
      return;
    }
    const press = this.#decide(controls, playing, atEnd, live);
    if (press) {
      press.click();
      this.#quietUntil = performance.now() + LANDING_MS;
      this.#wake = setTimeout(this.tick, LANDING_MS);
    }
  };

  /** A walk that has just mounted: the first one, or a fresh one after its X. */
  #fresh(toolbar: Element, live: Live): void {
    this.dispose();
    this.#walk = toolbar;
    this.#seized = false;
    this.#started = false;
    this.#finished = false;
    this.#wasPlaying = false;
    this.#wasVisible = live.visible;
    this.#pausedByScene = false;
    this.#restDue = false;
    this.#quietUntil = 0;
  }

  #decide(c: Controls, playing: boolean, atEnd: boolean, live: Live): HTMLButtonElement | null {
    if (live.closing) return null;
    // The walk starts itself a second after its first station loads unless its controls were
    // touched first. Pressing FROM, where it already is, touches them: the scene decides when it
    // plays, and that is when it is seen.
    if (!this.#seized) {
      this.#seized = true;
      return c.stations[0] ?? null;
    }
    if (live.visible !== this.#wasVisible) {
      this.#wasVisible = live.visible;
      if (!live.visible && playing) {
        this.#pausedByScene = true;
        return c.play;
      }
      if (live.visible && this.#pausedByScene) {
        this.#pausedByScene = false;
        if (!playing && !atEnd) return c.play;
      }
    }
    if (this.mode === "final") return this.#final(c, atEnd);
    if (this.mode !== "loop" || !live.visible) return null;
    if (this.#restDue) {
      this.#restDue = false;
      // Play at the end starts the walk over from FROM.
      return atEnd && !playing ? c.play : null;
    }
    if (!this.#started) {
      if (loading(c.stations[0]!)) return null;
      this.#started = true;
      return playing ? null : c.play;
    }
    // A chip on the rail moved the walk off its answer while it rested: carry on from there.
    if (this.#rest && !atEnd) {
      clearTimeout(this.#rest.timer);
      this.#rest = null;
      return playing ? null : c.play;
    }
    return null;
  }

  /** Reduced motion or autoplay off: the answer, at once — the last station's last phase. */
  #final(c: Controls, atEnd: boolean): HTMLButtonElement | null {
    if (this.#finished || c.stations.some(loading)) return null;
    const last = c.stations.findLast(playable);
    if (!last) return null;
    if (last.getAttribute("aria-current") !== "step") return last;
    if (!atEnd) return c.forward;
    this.#finished = true;
    this.done();
    return null;
  }

  /** The rest on the answer counts only while the scene is on screen. */
  #keepRest(live: Live): void {
    const rest = this.#rest;
    if (!rest) return;
    const running = live.visible && !live.closing;
    if (running && rest.timer === undefined) {
      rest.since = performance.now();
      rest.timer = setTimeout(() => {
        this.#rest = null;
        this.#restDue = true;
        this.tick();
      }, rest.left);
    } else if (!running && rest.timer !== undefined) {
      clearTimeout(rest.timer);
      rest.timer = undefined;
      rest.left = Math.max(0, rest.left - (performance.now() - rest.since));
    }
  }
}

function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const query = matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

declare global {
  interface Window {
    /** Dev only: every probe the walk sent, and the ones no recording answers. */
    __walkMisses?: { probes: number; misses: string[] };
  }
}

const RECORDED = new Set(
  [...birdwatch.recordings, ...walkRecordings].map((r) => r.key || normaliseSql(r.request.sql)),
);

/** The replay's probe, counted in development so a test can prove every one was recorded. */
function useCountedProbe(probe: WorkspaceApi["probe"]): WorkspaceApi["probe"] {
  const latest = React.useRef(probe);
  React.useLayoutEffect(() => {
    latest.current = probe;
  });
  // Stable: the walk sends its probes again whenever this changes identity.
  return React.useCallback<WorkspaceApi["probe"]>((sql, options) => {
    if (import.meta.env.DEV) {
      const tally = (window.__walkMisses ??= { probes: 0, misses: [] });
      tally.probes += 1;
      if (!RECORDED.has(normaliseSql(sql))) tally.misses.push(sql);
    }
    return latest.current(sql, options);
  }, []);
}

/**
 * The walk's narrator scrolls the clause it is on into view with `scrollIntoView`, which also
 * scrolls the PAGE whenever that clause is off screen — mid-walk, under a visitor reading
 * something else. Inside a walk window it scrolls the walk's own scroll boxes instead, and stops
 * at the window.
 */
function containScrollIntoView(): void {
  const native = Element.prototype.scrollIntoView;
  if ("walkContained" in native) return;
  const contained = function scrollIntoView(
    this: Element,
    ...args: Parameters<Element["scrollIntoView"]>
  ): void {
    const scene = this.closest("[data-walk-window]");
    if (!scene) {
      native.apply(this, args);
      return;
    }
    for (let box = this.parentElement; box && box !== scene; box = box.parentElement) {
      if (box.scrollHeight <= box.clientHeight) continue;
      if (!box.hasAttribute("data-walk-scroller") && !/auto|scroll/.test(getComputedStyle(box).overflowY)) continue;
      const outer = box.getBoundingClientRect();
      const scale = box.offsetHeight > 0 ? outer.height / box.offsetHeight : 1;
      const inner = this.getBoundingClientRect();
      const top = (inner.top - outer.top) / scale - box.clientTop;
      const bottom = top + inner.height / scale;
      if (top < 0) box.scrollTop += top;
      else if (bottom > box.clientHeight) box.scrollTop += Math.min(top, bottom - box.clientHeight);
    }
  };
  Element.prototype.scrollIntoView = Object.assign(contained, { walkContained: true });
}
containScrollIntoView();

/**
 * Marks every box inside the walk that scrolls, as it mounts, so walk.css can stop it scrolling
 * while the scene is pinned. Found by computed style, so nothing here depends on the walk's markup.
 */
function markScrollers(app: HTMLElement): () => void {
  const mark = (element: Element): void => {
    if (element.hasAttribute("data-walk-scroller")) return;
    const style = getComputedStyle(element);
    if (/auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)) {
      element.setAttribute("data-walk-scroller", "");
    }
  };
  const scan = (root: Element): void => {
    mark(root);
    for (const element of root.querySelectorAll("*")) mark(element);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  });
  observer.observe(app, { childList: true, subtree: true });
  scan(app);
  return () => observer.disconnect();
}

export type WalkStageProps = Pick<SceneProps, "autoplay" | "onReady" | "onDone"> & {
  parts: SceneWindowParts;
  railRef: React.RefObject<HTMLDivElement | null>;
  /** At least 40% on screen. */
  visible: boolean;
};

export default function WalkStage({
  parts,
  railRef,
  visible,
  autoplay = true,
  onReady,
  onDone,
}: WalkStageProps): React.ReactElement {
  const { api: replayed } = useReplayWorkspace(REPLAY);
  const probe = useCountedProbe(replayed.probe);
  const api = React.useMemo<WorkspaceApi>(() => ({ ...replayed, probe }), [replayed, probe]);
  const reduced = useReducedMotion();
  const mode: Mode = autoplay && !reduced ? "loop" : "final";

  const [round, setRound] = React.useState(0);
  const [closing, setClosing] = React.useState(false);
  React.useEffect(() => {
    if (!closing) return;
    const id = setTimeout(() => {
      setRound((n) => n + 1);
      setClosing(false);
    }, CLOSED_MS);
    return () => clearTimeout(id);
  }, [closing]);

  const callbacks = React.useRef({ onReady, onDone });
  const live = React.useRef<Live>({ visible, closing });
  React.useLayoutEffect(() => {
    callbacks.current = { onReady, onDone };
    live.current.visible = visible;
    live.current.closing = closing;
  });

  const pilot = React.useRef<Pilot | null>(null);
  React.useEffect(() => {
    const next = new Pilot(parts.app, mode, live, () => callbacks.current.onDone?.());
    pilot.current = next;
    const observer = new MutationObserver(next.tick);
    observer.observe(parts.app, {
      attributes: true,
      attributeFilter: ["aria-current", "aria-label", "disabled"],
      childList: true,
      subtree: true,
    });
    next.tick();
    return () => {
      observer.disconnect();
      next.dispose();
      pilot.current = null;
    };
  }, [mode, parts.app]);
  React.useEffect(() => {
    pilot.current?.tick();
  }, [visible, closing]);

  React.useEffect(() => markScrollers(parts.app), [parts.app]);

  // Ready once the walk is up and the fonts are in, so the anchors measure where they will stay.
  const announced = React.useRef(false);
  React.useEffect(() => {
    if (announced.current) return;
    let current = true;
    const announce = async (): Promise<void> => {
      await document.fonts.ready;
      if (!current || announced.current) return;
      announced.current = true;
      const anchors: SceneAnchors = { window: parts.window, titlebar: parts.titlebar };
      if (railRef.current) anchors.rail = railRef.current;
      callbacks.current.onReady?.(anchors);
    };
    const observer = new MutationObserver(() => {
      if (!controlsIn(parts.app)) return;
      observer.disconnect();
      void announce();
    });
    if (controlsIn(parts.app)) void announce();
    else observer.observe(parts.app, { childList: true, subtree: true });
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [parts, railRef]);

  return (
    <DialogHost container={parts.app} onClose={() => setClosing(true)}>
      <DialogFrame closing={closing}>
        <WorkspaceProvider value={api}>
          <QueryWalk key={round} sql={WALK_SQL} />
        </WorkspaceProvider>
      </DialogFrame>
    </DialogHost>
  );
}
