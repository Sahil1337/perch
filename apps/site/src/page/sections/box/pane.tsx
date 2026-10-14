import type { CSSProperties, Ref } from "react";
import { cn } from "../../../shared/cn";
import { clamp } from "../../../shared/math";
import { BOX_ITEMS, type BoxItem, cropUrl } from "./items";

export type CropState = "loaded" | "failed";

// The scenes' titlebar at the app's own size (600 wide, 40 tall: size-3 lights from left-3.5,
// a 24px pill holding 12px type), drawn as SVG so it scales with the pane the way the crops do.
const ADDRESS = "127.0.0.1:4600";
const PILL_WIDTH = 111;

function Titlebar() {
  return (
    <div className="border-b border-border bg-sidebar">
      <svg viewBox="0 0 600 40" className="block w-full">
        {[20, 40, 60].map((cx) => (
          <circle key={cx} cx={cx} cy={20} r={6} className="fill-input" />
        ))}
        <rect x={300 - PILL_WIDTH / 2} y={8} width={PILL_WIDTH} height={24} rx={6} className="fill-secondary" />
        <text
          x={300}
          y={20.5}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          className="fill-muted-foreground font-sans tabular-nums"
        >
          {ADDRESS}
        </text>
      </svg>
    </div>
  );
}

// On a phone the pane is about 290–400px wide, so a whole 600px crop comes out at half size. Each crop
// zooms onto its focus: scaled about the origin that puts the focus in the middle, held to the crop's
// edges so the window never shows past them.
function focusOrigin({ x, y, zoom }: BoxItem["focus"]): string {
  const origin = (at: number) => clamp((at * zoom - 0.5) / (zoom - 1), 0, 1) * 100;
  return `${origin(x).toFixed(1)}% ${origin(y).toFixed(1)}%`;
}

export type BoxPaneProps = {
  /** The crop on show, or null before any has loaded. */
  shown: string | null;
  onCrop: (key: string, state: CropState) => void;
  className?: string;
  ref?: Ref<HTMLDivElement>;
};

/**
 * A window on the app showing the crop for the item in hand. Decorative: the list beside it
 * says everything in words. The window's box is held from the first paint (the titlebar's viewBox,
 * the crops' 4:3), so nothing moves when the images arrive.
 */
export function BoxPane({ shown, onCrop, className, ref }: BoxPaneProps) {
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn("dark overflow-hidden rounded-lg bg-background shadow-lg ring-1 ring-border", className)}
    >
      <Titlebar />
      <div className="grid aspect-4/3 overflow-hidden">
        {BOX_ITEMS.map(({ key, focus }) => (
          // The incoming crop fades in over the outgoing one, which only goes once it is covered,
          // so the crossfade never dips to the empty window between them.
          <div
            key={key}
            className={cn(
              "col-start-1 row-start-1 overflow-hidden transition-opacity motion-reduce:transition-none",
              key === shown ? "z-10 opacity-100 duration-250 ease-out" : "opacity-0 delay-250 duration-0",
            )}
          >
            {/* On a phone each crop arrives whole, then eases in on its focus and holds there; the
                outgoing one drops back to whole only once it is covered. */}
            <img
              src={cropUrl(key)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => onCrop(key, "loaded")}
              onError={() => onCrop(key, "failed")}
              style={{ "--zoom": String(focus.zoom), "--focus": focusOrigin(focus) } as CSSProperties}
              className={cn(
                "size-full origin-(--focus) object-cover motion-safe:max-md:transition-transform",
                key === shown
                  ? "max-md:scale-(--zoom) max-md:delay-800 max-md:duration-900 max-md:ease-in-out"
                  : "max-md:delay-250 max-md:duration-0",
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
