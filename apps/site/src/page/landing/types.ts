import type { RefObject } from "react";
import type { Bird } from "../../shared/bird";
import type { TryWindow } from "../sections/try/window";

/** The landing's copy, which a scene draws around and must never cover. */
export type CopyParts = {
  /** The whole block: the H1, the lede and the CTA row. */
  root: RefObject<HTMLDivElement | null>;
  /** The H1; each word is a `[data-word]` span. */
  title: RefObject<HTMLHeadingElement | null>;
  lede: RefObject<HTMLParagraphElement | null>;
  /** The install command and the download button. */
  cta: RefObject<HTMLDivElement | null>;
};

/**
 * Where a scene wants the copy. The copy paints in the first frame, before the scene's chunk has
 * arrived, so each scene states this in a light module of its own, apart from the scene.
 */
export type CopyPlacement = {
  /** On the landing section: its padding, stacking, and how it holds the copy. */
  section: string;
  /** On the copy block: its width, place and alignment. */
  copy: string;
  /** On the CTA row. */
  cta: string;
};

/** What the landing hands a scene: the props of each scene module's default export. */
export type LandingSceneProps = {
  /** The landing section. It is the positioned ancestor of whatever the scene draws. */
  stage: RefObject<HTMLElement | null>;
  copy: CopyParts;
  /** The bird while the landing drives it: null until it has loaded, and while the page's route has it. */
  bird: Bird | null;
  /** The real window under "Your turn", where the hand-over ends. */
  target: TryWindow;
  /** The intro is over, skipped or scrolled past: the window's app may load now. */
  onSettled: () => void;
};
