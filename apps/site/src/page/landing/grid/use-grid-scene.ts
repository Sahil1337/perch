import { type RefObject, useEffect } from "react";
import type { TryWindow } from "../../sections/try/window";
import type { Point } from "../math";
import type { CopyParts } from "../types";
import type { PorcelainBird } from "./bird/porcelain-bird";
import { measureHeadline } from "./copy/headline";
import { GridScene, type SceneHooks } from "./grid-scene";
import { HandOver } from "./hand-over";

/** However the fonts go, the grid is drawn after this long. */
const FONT_WAIT_MS = 900;
/** However the intro goes, the window below is not held back for longer than this. */
const SETTLE_ANYWAY_MS = 9000;
/** A reload this far down the page lands straight on the settled frame. */
const SKIP_BELOW = 0.3;
/** Scrolling this far counts as moving on from the intro. */
const SCROLLED = 8;
/** What a tap on these starts is theirs, not a ripple's. */
const CONTROLS = "a, button, input, [role='button'], [tabindex]";

export type GridSceneParts = {
  layer: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  stage: RefObject<HTMLElement | null>;
  copy: CopyParts;
  window: Pick<TryWindow, "frame" | "results">;
  porcelain: PorcelainBird;
  /** The latest of each, read when they fire. */
  ran: RefObject<boolean>;
  onSettled: RefObject<() => void>;
  /** Filled once the grid is up, so the component can tell the hand-over the demo has run. */
  handOver: RefObject<HandOver | null>;
};

/**
 * Runs the grid on the canvas for as long as the scene is mounted: made once its mono font is ready,
 * kept to the viewport and the copy's layout, driven by scroll and the pointer, and disposed of with
 * everything it started.
 */
export function useGridScene(parts: GridSceneParts) {
  const { layer, canvas, stage, copy, window: tryWindow, porcelain, ran, onSettled, handOver } = parts;

  useEffect(() => {
    const host = layer.current;
    const el = canvas.current;
    const section = stage.current;
    if (!host || !el || !section) return;
    const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
    let scene: GridScene | null = null;
    let live = true;
    let settled = false;
    let frameId = 0;
    // The perch's feet in page px, measured with the headline, so a frame reads no layout for it.
    let perchX = 0;
    let perchY = 0;
    let hasPerch = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      onSettled.current();
    };

    const measure = () => {
      const title = copy.title.current;
      if (!scene || !title) return;
      const headline = measureHeadline(title);
      porcelain.setPerch(headline.perch);
      const perch = headline.perch;
      hasPerch = perch !== null;
      if (perch) {
        const r = perch.el.getBoundingClientRect();
        perchX = r.left + perch.at * r.width;
        perchY = r.top + perch.offsetY + scrollY;
      }
      scene.measureCopy(copy, headline);
    };

    const update = () => {
      frameId = 0;
      handOver.current?.update(performance.now(), true);
    };
    const schedule = () => {
      frameId ||= requestAnimationFrame(update);
      if (scrollY > SCROLLED) settle();
    };

    const hooks: SceneHooks = {
      perch(out: Point) {
        out.x = perchX;
        out.y = perchY - scrollY;
        return hasPerch;
      },
      birdReady: () => porcelain.ready,
      resolve: () => porcelain.release(),
      look: (point) => porcelain.lookAt(point),
      settled: settle,
      birdLength: () => porcelain.size,
      frame: () => handOver.current?.update(performance.now(), false),
    };

    const skip = () => {
      scene?.skipIntro();
      porcelain.release();
    };
    const onResize = () => {
      if (!scene) return;
      scene.resize();
      measure();
      schedule();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") scene?.setPointer({ x: event.clientX, y: event.clientY });
    };
    const onPointerLeave = () => scene?.setPointer(null);
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(CONTROLS)) return;
      scene?.ripple({ x: event.clientX, y: event.clientY });
    };
    const onMotion = () => {
      scene?.setReduced(reducedQuery.matches);
      if (reducedQuery.matches) skip();
      schedule();
    };
    const reflow = new ResizeObserver(measure);
    const fallback = setTimeout(settle, SETTLE_ANYWAY_MS);

    // The grid's own face, and the headline's: the bird's perch is measured on the headline's
    // final wrap, so a placed bird never has to move when the font arrives.
    const fonts = Promise.all([
      document.fonts.load('400 13px "Geist Mono Variable"'),
      document.fonts.load('640 13px "Geist Mono Variable"'),
      document.fonts.load('600 48px "Geist Variable"'),
    ]);
    void Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).then(() => {
      if (!live) return;
      scene = new GridScene(el, hooks);
      const over = new HandOver(host, scene, tryWindow, () => reducedQuery.matches);
      over.setRan(ran.current);
      handOver.current = over;
      scene.resize();
      measure();
      if (reducedQuery.matches) scene.setReduced(true);
      if (reducedQuery.matches || scrollY > innerHeight * SKIP_BELOW) skip();
      const root = copy.root.current;
      if (root) reflow.observe(root);
      el.dataset.ready = "";
      update();
    });

    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", onResize);
    addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", schedule);
    reducedQuery.addEventListener("change", onMotion);
    section.addEventListener("pointerdown", onPointerDown);
    // A late font can move the headline's words without resizing the copy: measure again.
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      live = false;
      cancelAnimationFrame(frameId);
      clearTimeout(fallback);
      reflow.disconnect();
      removeEventListener("scroll", schedule);
      removeEventListener("resize", onResize);
      removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", schedule);
      reducedQuery.removeEventListener("change", onMotion);
      section.removeEventListener("pointerdown", onPointerDown);
      document.fonts.removeEventListener("loadingdone", measure);
      scene?.destroy();
      handOver.current = null;
      porcelain.destroy();
    };
    // Made once: everything the scene reads later goes through refs and the porcelain bird.
  }, [layer, canvas, stage, copy, tryWindow, porcelain, ran, onSettled, handOver]);
}
