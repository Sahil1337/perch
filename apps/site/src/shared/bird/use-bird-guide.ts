import { type RefObject, useEffect, useRef } from "react";
import type { Bird, BirdFacing, GuideStep } from "./bird";
import { useBird } from "./bird-provider";

export type BirdGuideStep = {
  /** The perch: a ref, or a function for an element that arrives later (a scene's titlebar). */
  ref: RefObject<HTMLElement | null> | (() => HTMLElement | null);
  /** 0..1 along the element's top edge. Default 0.8. */
  at?: number;
  facing?: BirdFacing;
  /** 0..1, default 0.3: how much of the viewport, centred, counts as this step's band. */
  band?: number;
  /** Lowers the branch, for rounded corners or borders. */
  offsetY?: number;
};

const resolve = (ref: BirdGuideStep["ref"]) => (typeof ref === "function" ? ref() : ref.current);

/**
 * Has the bird follow the page: as it scrolls, the bird flies to the step whose element is nearest
 * the viewport's centre band. The elements are looked up again after every render, and the guide
 * re-registered only when one of them or a step's options changed, so a function ref that starts
 * returning a scene's titlebar takes effect on the next render.
 */
export function useBirdGuide(steps: BirdGuideStep[]): void {
  const bird = useBird();
  const registered = useRef<{ bird: Bird | null; elements: (HTMLElement | null)[]; options: string } | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!bird) return;
    const elements = steps.map((step) => resolve(step.ref));
    const options = JSON.stringify(steps.map(({ at, facing, band, offsetY }) => [at, facing, band, offsetY]));
    const last = registered.current;
    if (
      last &&
      last.bird === bird &&
      last.options === options &&
      last.elements.length === elements.length &&
      last.elements.every((el, i) => el === elements[i])
    ) {
      return;
    }
    registered.current = { bird, elements, options };
    const list: GuideStep[] = [];
    steps.forEach((step, i) => {
      const el = elements[i];
      if (!el) return;
      list.push({ el, at: step.at, facing: step.facing, band: step.band, offsetY: step.offsetY });
    });
    stop.current?.();
    try {
      stop.current = bird.guide(list);
    } catch {
      stop.current = null;
    }
  });

  useEffect(
    () => () => {
      stop.current?.();
      stop.current = null;
      registered.current = null;
    },
    [bird],
  );
}
