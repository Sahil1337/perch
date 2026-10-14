import { toRgb } from "../to-rgb";
import type { BirdPalette } from "./bird";

/** The palette with every colour (any CSS colour, `var(--token)` included) as rgb(). */
export function resolvePalette(palette: BirdPalette | undefined): BirdPalette | undefined {
  if (!palette) return undefined;
  return Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [key, typeof value === "string" ? toRgb(value) : value]),
  ) as BirdPalette;
}
