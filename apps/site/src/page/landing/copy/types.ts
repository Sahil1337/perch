import type { RefObject } from "react";

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
