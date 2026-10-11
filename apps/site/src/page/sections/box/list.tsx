import { motion } from "motion/react";
import type { PointerEvent, Ref } from "react";
import { cn } from "../../../shared/cn";
import { EASE_OUT } from "../../../shared/motion";
import { body } from "../../layout/type";
import { BOX_ITEMS } from "./items";
import { Keys } from "./keys";

export type BoxListProps = {
  active: number;
  /** A mouse came over an item (it holds the pane while it stays on the list), or anything clicked or tapped one. */
  onPoint: (index: number, hover: boolean) => void;
  /** The mouse left the list. */
  onRelease: () => void;
  className?: string;
  ref?: Ref<HTMLUListElement>;
};

const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * The eight items, as plain text: the pane beside them is decoration, so they are not controls.
 * The item the pane is showing is lifted and carries the app's own selection mark: the 2px bar of
 * ink its vertical tabs slide from tab to tab, on the list's left edge. Items are padded rather
 * than spaced, so the pointer never falls into a gap between two of them.
 */
export function BoxList({ active, onPoint, onRelease, className, ref }: BoxListProps) {
  return (
    <ul
      ref={ref}
      className={className}
      onPointerLeave={(event) => {
        if (isMouse(event)) onRelease();
      }}
    >
      {BOX_ITEMS.map((item, index) => {
        const on = index === active;
        return (
          <li
            key={item.key}
            className="relative py-4 pl-4 lg:pl-5"
            onPointerEnter={(event) => {
              if (isMouse(event)) onPoint(index, true);
            }}
            onClick={() => onPoint(index, false)}
          >
            {on ? (
              <motion.span
                aria-hidden
                layoutId="box-mark"
                transition={{ duration: 0.3, ease: EASE_OUT }}
                className="absolute inset-y-5 left-0 w-0.5 rounded-full bg-primary"
              />
            ) : null}
            <div className="flex items-center gap-3">
              <h3
                className={cn(
                  body,
                  "max-w-none font-medium transition-colors duration-250 ease-out",
                  on ? "text-foreground" : "text-foreground lg:text-muted-foreground",
                )}
              >
                {item.title}
              </h3>
              {item.keys ? <Keys keys={item.keys} /> : null}
            </div>
            <p
              className={cn(
                body,
                "mt-1 transition-colors duration-250 ease-out",
                on ? "text-muted-foreground" : "text-muted-foreground lg:text-muted-foreground/60",
              )}
            >
              {item.text}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
