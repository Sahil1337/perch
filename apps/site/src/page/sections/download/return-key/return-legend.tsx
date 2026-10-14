import { ReturnGlyph } from "../../../materials";

/** The legend the first view's return key is fired with: its name small in the corner, ↵ beside it. */
export function ReturnLegend() {
  return (
    <span aria-hidden className="flex items-end gap-1 lg:gap-1.5">
      return
      <ReturnGlyph className="mb-px h-2 w-3.5 lg:h-2.5 lg:w-4" />
    </span>
  );
}
