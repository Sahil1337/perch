import { toRgb } from "../../../../shared/to-rgb";

/** The sculpture's colours, as three.js reads them. */
export type SculptureColors = {
  porcelain: string;
  glaze: string;
  light: string;
  sky: string;
  ground: string;
  shadow: string;
};

/** The page's materials and the scene's own light (keys.css), resolved where `host` sits. */
export function readSculptureColors(host: Element): SculptureColors {
  const read = (token: string) => toRgb(`var(--${token})`, host);
  return {
    porcelain: read("porcelain"),
    glaze: read("glaze"),
    light: read("porcelain-light"),
    sky: read("keys-sky"),
    ground: read("keys-ground"),
    shadow: read("keys-shadow"),
  };
}
