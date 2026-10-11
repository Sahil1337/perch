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

/** The `--keys-*` tokens from keys.css, resolved where `host` sits. */
export function readSculptureColors(host: Element): SculptureColors {
  const read = (name: string) => toRgb(`var(--keys-${name})`, host);
  return {
    porcelain: read("porcelain"),
    glaze: read("glaze"),
    light: read("light"),
    sky: read("sky"),
    ground: read("ground"),
    shadow: read("shadow"),
  };
}
