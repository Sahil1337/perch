import { motion } from "motion/react";
import { type PointerEvent, type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react";
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
  onRelease?: () => void;
  /** The pinned stage: every title, but only the item in hand opens to its text and its keys. */
  pinned?: boolean;
  className?: string;
  ref?: Ref<HTMLUListElement>;
};

const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * Opens to its content's height and folds to nothing. The height is measured here rather than left
 * to motion's `"auto"`: resolving that, motion puts the window's scroll back where it found it,
 * which cuts short the smooth scroll a click on an item has just started.
 */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div
      initial={false}
      animate={{ height: open ? height : 0 }}
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="overflow-hidden"
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

/**
 * The items, as plain text: the pane beside them is decoration, so they are not controls.
 * The item the pane is showing is lifted and carries the app's own selection mark: the 2px bar of
 * ink its vertical tabs slide from tab to tab, on the list's left edge. Items are padded rather
 * than spaced, so the pointer never falls into a gap between two of them.
 *
 * Pinned, the list has to fit the view beside the pane, so it is set tighter and only the item in
 * hand opens; its text unfolds as the last one folds away, and the bar slides with it.
 */
export function BoxList({ active, onPoint, onRelease, pinned, className, ref }: BoxListProps) {
  return (
    <ul
      ref={ref}
      className={className}
      onPointerLeave={(event) => {
        if (isMouse(event)) onRelease?.();
      }}
    >
      {BOX_ITEMS.map((item, index) => {
        const on = index === active;
        const text = (
          <p
            className={cn(
              body,
              "transition-colors duration-250 ease-out",
              pinned ? "pt-1 pb-1.5" : "mt-1",
              on ? "text-muted-foreground" : "text-muted-foreground lg:text-muted-foreground/60",
            )}
          >
            {item.text}
          </p>
        );
        return (
          <li
            key={item.key}
            className={cn("relative pl-4 lg:pl-5", pinned ? "cursor-pointer py-2" : "py-4")}
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
                className={cn("absolute left-0 w-0.5 rounded-full bg-primary", pinned ? "inset-y-3" : "inset-y-5")}
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
              {item.keys ? (
                <Keys
                  keys={item.keys}
                  className={cn(pinned && "transition-opacity duration-300 ease-out", pinned && !on && "opacity-0")}
                />
              ) : null}
            </div>
            {pinned ? (
              <Fold open={on}>{text}</Fold>
            ) : (
              text
            )}
          </li>
        );
      })}
    </ul>
  );
}
