import type { ReactNode, Ref } from "react";
import { cn } from "../../shared/cn";

/** Each size is compact under lg, where a piece is at most 176px tall, and grows from lg. */
export type KeycapSize = "md" | "lg";

const SIZE: Record<KeycapSize, { face: string; radius: string }> = {
  md: { face: "h-10 min-w-10 px-2.5 text-sm lg:h-13 lg:min-w-13 lg:text-base", radius: "rounded-lg" },
  lg: { face: "h-14 min-w-14 px-3 text-lg lg:h-18 lg:min-w-18 lg:text-xl", radius: "rounded-xl" },
};

/** The legend's colour: the thin warm glaze of the first view's keys, or plain ink. */
export type KeycapInk = "glaze" | "ink";

const INK: Record<KeycapInk, string> = { glaze: "text-glaze", ink: "text-paper-ink" };

export type KeycapProps = {
  size?: KeycapSize;
  ink?: KeycapInk;
  /** Held down: the top face sinks into its skirt and the contact shadow tightens. */
  pressed?: boolean;
  /** The top face, the edge the bird stands on. */
  topRef?: Ref<HTMLSpanElement>;
  className?: string;
  /** Classes for the top face, for a wide key's layout. */
  faceClassName?: string;
  children?: ReactNode;
};

/**
 * A porcelain key, as the first view's keys are: a lit top face over a visible skirt, with a soft
 * contact shadow on the page. As wide as its legend, never narrower than it is tall, so a table's
 * name makes a tile. `press` (track.ts) animates the same parts a `pressed` key moves to.
 */
export function Keycap({
  size = "md",
  ink = "glaze",
  pressed,
  topRef,
  className,
  faceClassName,
  children,
}: KeycapProps) {
  const { face, radius } = SIZE[size];
  return (
    <span
      data-keycap=""
      data-pressed={pressed || undefined}
      className={cn("group/keycap relative inline-flex shrink-0 flex-col pb-1.5", className)}
    >
      <span
        aria-hidden
        data-keycap-shadow=""
        className="porcelain-contact absolute -inset-x-1.5 -bottom-2 h-5 transition duration-100 ease-out group-data-pressed/keycap:scale-x-95 group-data-pressed/keycap:opacity-70"
      />
      <span aria-hidden className={cn("porcelain-skirt absolute inset-x-0 top-1.5 bottom-0", radius)} />
      <span
        ref={topRef}
        data-keycap-top=""
        className={cn(
          "porcelain relative flex items-center justify-center font-mono leading-none transition-transform duration-100 ease-out group-data-pressed/keycap:translate-y-0.75",
          face,
          radius,
          INK[ink],
          faceClassName,
        )}
      >
        {children}
      </span>
    </span>
  );
}
