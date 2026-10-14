// One real scene: the workspace on replayed data inside its frame, and a script that plays it like a
// person would — on a loop, or once and then handed to the visitor for a `usable` scene. Shared by
// every real scene; a scene supplies only its `SceneScript`.

import { closeCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { RESULTS_PANE, WorkspaceProvider, type EditorLayout, type WorkspaceApi } from "@perch/ui";
import * as React from "react";
import type { SceneAnchors } from "../types";
import type { ReplayInput, ReplayWorkspace } from "../../replay/types";
import { REPLAY_NOTICE } from "../../replay/store";
import { useReplayWorkspace } from "../../replay/use-replay";
import { activateScene, deactivateScene } from "./active-scene";
import { usePrefersReducedMotion } from "../../viewport/media";
import { useVisible } from "../../viewport/visibility";
import { Clock, Stopped } from "./autoplay";
import { CAMERA_MS, Camera, type Focus, HOLD_MS, ROWS } from "./camera";
import { houseTooltips, pressKey, scriptEditor } from "./editor-driver";
import type { RealSceneProps } from "./lazy-scene";
import { WorkspaceShell } from "./workspace-shell";

/** How long a close-up's loop holds its wide last frame before it starts over. */
const CLOSE_UP_HOLD = 2000;

/** Below this frame width a "narrow" camera turns on: the whole window is too small to read. */
export const NARROW_WIDTH = 700;

export type SceneContext = {
  /** The workspace as it is now (the contract's snapshot, current at every call). */
  readonly api: () => WorkspaceApi;
  readonly store: ReplayWorkspace;
  readonly clock: Clock;
  /** The element the camera moves; the app is laid out inside it at native size. */
  readonly stage: HTMLElement;
  /** Null when the camera is off: reduced motion, or a wide frame for a "narrow" scene. */
  readonly camera: Camera | null;
  /** The frame's rendered width, in page pixels. */
  readonly frameWidth: () => number;
  /** Tells the page the demo reached its nth beat, for a `usable` scene's narration. */
  readonly beat: (index: number) => void;
};

export type SceneScript = {
  readonly camera: "always" | "narrow";
  readonly input: ReplayInput;
  /**
   * The demo, from the store's initial state to its main beat, which is its last frame. Awaits only
   * `clock.sleep`, so it pauses.
   */
  play(context: SceneContext): Promise<void>;
  /** How long a looping scene rests on that last frame before it starts over. */
  readonly hold: number;
  /** The loop's last frame, reached at once: reduced motion, or autoplay off. */
  final(context: SceneContext): Promise<void>;
  /**
   * In a phone's close-up, the detail a still last frame holds (reduced motion, or autoplay off):
   * the demo's outcome, its results say. The whole window otherwise.
   */
  rest?(camera: Camera, stage: HTMLElement): Focus | null;
  /** Extra anchors for the bird, looked up under the stage once the app is up. */
  anchors?(stage: HTMLElement): Record<string, HTMLElement | null | undefined>;
};

export function RealScene({
  parts,
  size,
  script,
  autoplay = true,
  usable = false,
  paused = false,
  skip = false,
  live,
  handOver,
  onReady,
  onDone,
  onBeat,
}: RealSceneProps & { script: SceneScript }): React.ReactElement {
  const { api, store } = useReplayWorkspace(script.input);
  const latest = React.useRef(api);
  latest.current = api;
  const callbacks = React.useRef({ onReady, onDone, onBeat, handOver });
  React.useLayoutEffect(() => {
    callbacks.current = { onReady, onDone, onBeat, handOver };
  });

  const stageRef = React.useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const visible = useVisible(parts.outer);
  /** The running script's clock. Made per run of the effect, so a remount starts a fresh one. */
  const clock = React.useRef<Clock | null>(null);
  const camera = React.useRef<Camera | null>(null);
  /** A usable scene's way out of its demo, set while the demo plays. */
  const skipDemo = React.useRef<(() => void) | null>(null);

  // A notebook cell opens its messages only for an error, so the visitor's unrecorded query there
  // would read as an empty success. The notice is the answer: open it under the cell that ran.
  const noticed = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const run = api.runs[0];
    if (!live || run?.status !== "done" || run.id === noticed.current) return;
    noticed.current = run.id;
    if (!run.results?.some((statement) => statement.notices.includes(REPLAY_NOTICE))) return;
    const cell = document.activeElement?.closest("article");
    if (cell && stageRef.current?.contains(cell)) openMessages(cell);
  }, [api, live]);

  // The app's global shortcuts, palette and dialogs belong to the scene the visitor has.
  React.useEffect(() => {
    if (!live) return;
    activateScene(parts.window);
    return () => deactivateScene(parts.window);
  }, [live, parts.window]);

  // Ready once the app is up and its fonts are in, so anchors measure where they will stay.
  React.useEffect(() => {
    let live = true;
    const stage = stageRef.current;
    if (!stage) return;
    void (async () => {
      while (live && !stage.querySelector(".cm-editor")) await new Promise((r) => setTimeout(r, 50));
      await document.fonts.ready;
      if (!live) return;
      const anchors: SceneAnchors = { window: parts.window, titlebar: parts.titlebar };
      const found = {
        sidebar: stage.querySelector<HTMLElement>("aside"),
        statusBar: stage.querySelector<HTMLElement>("footer"),
        topbar: stage.querySelector<HTMLElement>("header"),
        runButton: [...stage.querySelectorAll<HTMLElement>("header button")].find((b) =>
          b.textContent?.includes("Run"),
        ),
        editor: stage.querySelector<HTMLElement>(".cm-editor"),
        ...script.anchors?.(stage),
      };
      for (const [name, element] of Object.entries(found)) if (element) anchors[name] = element;
      callbacks.current.onReady?.(anchors);
    })();
    return () => {
      live = false;
    };
  }, [parts, script]);

  // Every editor the app mounts — the scene's, a tab the visitor opens, a notebook cell — keeps its
  // popups inside the window.
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const adopt = (): void => {
      frame = 0;
      for (const dom of stage.querySelectorAll<HTMLElement>(".cm-editor")) {
        const view = EditorView.findFromDOM(dom);
        if (view) houseTooltips(view, stage, () => stage.getBoundingClientRect());
      }
    };
    adopt();
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(adopt);
    });
    observer.observe(stage, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const playing = React.useRef(false);
  playing.current = visible && !paused;

  // The script: a loop while autoplay is on and motion is welcome, the last frame otherwise. A
  // usable scene plays once instead, and then the app is the visitor's.
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const final = reduced || !autoplay;
    const own = new Clock();
    clock.current = own;
    // The last frame is reached at once and wherever the window is: nothing to watch on the way.
    if (final || playing.current) own.run();
    const width = (): number => parts.outer.getBoundingClientRect().width;
    const cameraOn =
      !reduced && (script.camera === "always" || width() < NARROW_WIDTH);
    // A close-up always has its camera: even a still frame is a crop that has to be placed.
    const lens = parts.lens ?? null;
    camera.current = lens || (cameraOn && !final) ? new Camera(stage, size, width, lens) : null;
    const closeUp = camera.current?.closeUp ? camera.current : null;
    // A close-up opens wide on the whole window, from the first frame the app paints.
    closeUp?.to(null, 0);
    let alive = true;
    const done = (): void => {
      if (alive) callbacks.current.onDone?.();
    };
    const contextOn = (on: Clock): SceneContext => ({
      api: () => latest.current,
      store,
      clock: on,
      stage,
      get camera() {
        return camera.current;
      },
      frameWidth: width,
      beat: (index) => {
        if (alive) callbacks.current.onBeat?.(index);
      },
    });
    const context = contextOn(own);
    const handOverNow = async (on: Clock): Promise<void> => {
      // The visitor gets the window whole: a camera still in close comes back out first, at its
      // own pace, never in a cut.
      if (camera.current?.zoomed) {
        camera.current.to(null, CAMERA_MS);
        await on.sleep(CAMERA_MS);
      }
      camera.current = null;
      on.stop();
      release(stage);
      callbacks.current.handOver();
      done();
    };
    // Skipping stops the demo's clock wherever it is, which ends its script, and reaches the last
    // frame on a fresh clock with no camera: the visitor asked for the app, not the rest of the show.
    if (usable && !final) {
      skipDemo.current = () => {
        skipDemo.current = null;
        own.stop();
        camera.current?.to(null, 0);
        camera.current = null;
        const now = new Clock();
        clock.current = now;
        now.run();
        void (async () => {
          try {
            await script.final(contextOn(now));
            await handOverNow(now);
          } catch (error) {
            if (!(error instanceof Stopped)) console.error(error);
          }
        })();
      };
    }
    void (async () => {
      try {
        if (final) {
          await script.final(context);
          // The last frame's crop, once its results have rendered.
          if (closeUp) {
            await own.sleep(120);
            closeUp.to(script.rest?.(closeUp, stage) ?? null, 0);
          }
        }
        else if (usable) await script.play(context);
        else {
          for (;;) {
            await script.play(context);
            done();
            // A close-up has already shown the outcome up close and ends wide, which is no
            // picture to hold for long.
            await own.sleep(closeUp ? CLOSE_UP_HOLD : script.hold);
            await settle(stage, own, store);
          }
        }
        skipDemo.current = null;
        if (usable) await handOverNow(own);
        else done();
      } catch (error) {
        if (!(error instanceof Stopped)) console.error(error);
      }
    })();
    return () => {
      alive = false;
      skipDemo.current = null;
      own.stop();
      clock.current?.stop();
    };
    // Built once: a scene that changed its motion preference mid-visit keeps the mode it began in.
  }, []);

  // Scene time runs only while the window is mostly in view, and not held back by the page.
  React.useEffect(() => {
    if (visible && !paused) clock.current?.run();
    else if (!(reduced || !autoplay)) clock.current?.pause();
  }, [visible, paused, reduced, autoplay]);

  React.useEffect(() => {
    if (skip) skipDemo.current?.();
  }, [skip]);

  return (
    <div className="relative h-full w-full origin-top-left" ref={stageRef}>
      <WorkspaceProvider value={api}>
        <WorkspaceShell active={live} />
      </WorkspaceProvider>
    </div>
  );
}

/** Between loops: the editor and results dip out, the store goes back to its first state, and in. */
async function settle(stage: HTMLElement, clock: Clock, store: ReplayWorkspace): Promise<void> {
  const main = stage.querySelector("main");
  const fade = main?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out", fill: "forwards" });
  await clock.sleep(340);
  store.reset();
  await clock.sleep(60);
  main?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out" });
  fade?.cancel();
  await clock.sleep(600);
}

/**
 * The editors stop being driven: any popup the script left open closes, and the drawn caret stays
 * where the demo left it until the visitor's focus first lands in the app, from when the editor
 * shows focus the way the app does.
 */
function release(stage: HTMLElement): void {
  const views = (): EditorView[] =>
    [...stage.querySelectorAll<HTMLElement>(".cm-editor")].flatMap((dom) => EditorView.findFromDOM(dom) ?? []);
  for (const view of views()) closeCompletion(view);
  stage.addEventListener(
    "focusin",
    () => {
      for (const view of views()) scriptEditor(view, false);
    },
    { once: true },
  );
}

/** Switches a notebook cell to its messages, once the cell has its result (a render after the run). */
function openMessages(cell: Element): void {
  const open = (): boolean => {
    const toggle = [...cell.querySelectorAll("button")].find((button) => button.textContent === "Messages");
    toggle?.click();
    return toggle !== undefined;
  };
  if (open()) return;
  const observer = new MutationObserver(() => {
    if (open()) observer.disconnect();
  });
  observer.observe(cell, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 2000);
}

/** Resolves once the workspace's newest run has settled, polling in scene time. */
export async function waitForRun(context: SceneContext, since?: string): Promise<void> {
  for (;;) {
    const run = context.api().activeRun;
    if (run && run.id !== since && run.status !== "running") return;
    await context.clock.sleep(40);
  }
}

/** The app's first-run grid with the editor/results split moved, the way a visitor drags it. */
export function splitLayout(editor: number): EditorLayout {
  return {
    root: {
      kind: "branch",
      id: "branch-root",
      direction: "column",
      children: [
        { kind: "group", id: "group-editor", panes: [], activePane: null },
        { kind: "group", id: "group-results", panes: [RESULTS_PANE], activePane: RESULTS_PANE },
      ],
      sizes: [editor, 100 - editor],
    },
    focusedGroup: "group-editor",
  };
}

/** The results pane's rows, from its left edge, with the last lines of the query above them. */
export function restOnResults(camera: Camera, stage: HTMLElement): Focus | null {
  const results = stage.querySelector("section[aria-label='Query results']");
  if (!results) return null;
  const box = camera.box(results);
  return { x0: box.x, y0: box.y - 96, x1: box.x + box.w, y1: box.y + box.h, reading: ROWS };
}

/**
 * ⌘↵ and the run, the way each camera shows it. The desktop's pulls back to the whole window. A
 * close-up pulls back to both panes, so the run is seen to cross from the query to its results,
 * pushes in on the rows, and ends the loop wide.
 */
export async function showRun(context: SceneContext, view: EditorView): Promise<void> {
  const { camera, clock, stage } = context;
  const closeUp = camera?.closeUp ? camera : null;
  if (closeUp) {
    closeUp.to(closeUp.panes(), 900);
    await clock.sleep(1100);
  } else camera?.to(null, 1100);
  const before = context.api().activeRun?.id;
  pressKey(view, "Mod-Enter");
  await waitForRun(context, before);
  if (!closeUp) {
    await clock.sleep(1200);
    return;
  }
  await clock.sleep(700);
  closeUp.to(restOnResults(closeUp, stage), 900);
  await clock.sleep(900 + HOLD_MS * 2);
  closeUp.to(null, 1000);
  await clock.sleep(1000);
}
