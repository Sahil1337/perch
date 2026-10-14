import { type BirdSize, sizeFor } from "../../shared/bird";

/**
 * The bird's length, tail to beak, per breakpoint (md 48rem, lg 64rem). One size from the landing
 * to the footer: the bird is never resized in view, so both landing scenes are drawn to it.
 */
export const BIRD_SIZE = { base: 48, md: 60, lg: 72 } satisfies BirdSize;

/** The length BirdProvider gives the bird at this width, known before the bird has loaded. */
export const birdLength = (): number => sizeFor(BIRD_SIZE);
