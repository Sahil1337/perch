import type { HTMLAttributes, Ref } from "react";
import { cn } from "../../shared/cn";

/** How far a slip is turned, as the landing's kept slips are: never more than a hair. */
export type SlipTilt = -2 | -1 | 0 | 1 | 2;

const TILT: Record<SlipTilt, string> = {
  [-2]: "-rotate-2",
  [-1]: "-rotate-1",
  0: "",
  1: "rotate-1",
  2: "rotate-2",
};

export type SlipProps = HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  tilt?: SlipTilt;
};

/**
 * A paper slip: warm paper on the dark page, printed in mono, its bottom edge showing. Layout,
 * size and padding are the caller's. `data-slip` marks its print as text the bird keeps off.
 */
export function Slip({ ref, tilt = 0, className, children, ...rest }: SlipProps) {
  return (
    <div
      ref={ref}
      data-slip=""
      className={cn(
        "rounded-xs border-b border-paper-edge bg-paper font-mono text-paper-ink shadow-md shadow-background/70",
        TILT[tilt],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
