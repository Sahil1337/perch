import type { CopyPlacement } from "../types";

/**
 * The grid bird's copy: centred over the grid, in the height left under the nav. The bird never
 * crosses the copy, so centring it gives the two bands it flies in, under the actions and over the
 * headline, an even share of every phone's and tablet's height.
 */
export const placement: CopyPlacement = {
  section: "flex flex-col justify-center pt-14",
  copy: "mx-auto max-w-4xl items-center text-center",
  cta: "max-w-xl",
};
