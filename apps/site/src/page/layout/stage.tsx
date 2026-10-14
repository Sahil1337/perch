import { motion } from "motion/react";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "../../shared/cn";
import { EASE_IN_OUT, EASE_OUT, useInView, usePrefersReducedMotion } from "../../shared/motion";

// The stage: from lg a section is one view tall under the nav, its text in a narrow column on the
// page's measure and its window in the wide one, which bleeds out to the view's gutter. The window
// is held to the height that view leaves, so heading and window are always seen together. Under lg it stacks as every section does: text, what sits under it, window.
//
// Its entrance runs once, in time rather than with the scroll (the bird's route needs the page to
// scroll normally): the heading arrives alone, centred and a size up; a beat later it glides to its
// column as the window rises in from the other side; and only once the window has landed does its
// scene start, so the demo is never half over before the visitor sees it.

type Phase = "waiting" | "intro" | "split" | "landed";

// How long the heading holds alone, centred, before it moves to its column. The whole entrance
// takes under a second from the moment a fifth of the stage shows, so it has finished by the time
// a visitor scrolling at a normal pace has the stage in full view; one who arrives sooner sees it
// finish, never jump.
const INTRO_HOLD_MS = 300;
// The heading's size while it is alone on the stage.
const INTRO_SCALE = 1.1;
// How far the window travels in from its side, in px.
const WINDOW_TRAVEL = 64;

const LG = "(min-width: 64rem)";

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = matchMedia(LG);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => matchMedia(LG).matches,
  );
}

/** Where the text column's centre is from the row's, so the intro can hold the heading centred. */
function useCentring(
  row: RefObject<HTMLDivElement | null>,
  column: RefObject<HTMLDivElement | null>,
  text: RefObject<HTMLDivElement | null>,
  active: boolean,
) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const r = row.current;
    const c = column.current;
    const t = text.current;
    if (!active || !r || !c || !t) return;
    // Offsets, not client rects: they ignore the transforms the entrance is applying.
    const measure = () =>
      setOffset({
        x: r.offsetWidth / 2 - (c.offsetLeft + c.offsetWidth / 2),
        y: c.offsetHeight / 2 - (t.offsetTop + t.offsetHeight / 2),
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(r);
    return () => observer.disconnect();
  }, [row, column, text, active]);
  return offset;
}

/** The window's height over its width, for `stage-window` to turn the view's height into a width. */
function useWindowRatio(fit: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = fit.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) element.style.setProperty("--stage-ratio", (height / width).toFixed(4));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);
}

export type StageProps = {
  /** Which side the text takes from lg; the window takes the other. */
  side?: "start" | "end";
  /** The heading and its body: what the entrance shows first, on its own. */
  text: ReactNode;
  /** Under the text in its column, arriving with the window: the section's piece, or a rail. */
  below?: ReactNode;
  /** The window. `held` until the entrance has landed it: hold the scene's demo until then. */
  scene: (held: boolean) => ReactNode;
  /**
   * No entrance: everything is in place from the first paint and the scene is never held. For the
   * window the landing hands over into, which must be where it lands while the landing plays.
   */
  still?: boolean;
  className?: string;
};

export function Stage({ side = "start", text, below, scene, still, className }: StageProps) {
  const wide = useWide();
  const reduced = usePrefersReducedMotion();
  const row = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const fit = useRef<HTMLDivElement>(null);
  // From lg the row is one view tall and the entrance starts as it begins to enter; stacked, the row
  // is taller than the view.
  const seen = useInView(row, { amount: wide ? 0.2 : 0.15 });
  const [phase, setPhase] = useState<Phase>("waiting");
  const settled = still || reduced;
  const offset = useCentring(row, column, textBox, wide && !settled && (phase === "waiting" || phase === "intro"));
  useWindowRatio(fit);

  useEffect(() => {
    if (settled || !seen || phase !== "waiting") return;
    // Stacked, there is no column to glide to: the window just rises in under the text.
    setPhase(wide ? "intro" : "split");
  }, [settled, seen, phase, wide]);
  useEffect(() => {
    if (phase !== "intro") return;
    const timer = window.setTimeout(() => setPhase("split"), INTRO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const shown = settled ? "landed" : phase;
  const before = shown === "waiting" || shown === "intro";
  const travel = side === "start" ? WINDOW_TRAVEL : -WINDOW_TRAVEL;
  const rest = { opacity: 1, x: 0, y: 0, scale: 1 };
  const away = wide
    ? { opacity: 0, x: offset.x, y: offset.y + 16, scale: INTRO_SCALE }
    : { opacity: 0, x: 0, y: 16, scale: 1 };
  const alone = { opacity: 1, x: offset.x, y: offset.y, scale: INTRO_SCALE };
  const windowAway = { opacity: 0, x: wide ? travel : 0, y: wide ? 0 : 24 };

  return (
    <div
      ref={row}
      className={cn(
        "relative flex flex-col lg:stage-row lg:flex-row lg:items-center lg:gap-x-10 lg:py-8",
        side === "end" && "lg:flex-row-reverse",
        className,
      )}
    >
      <div ref={column} className="relative z-20 lg:w-1/3 lg:max-w-88 lg:shrink-0">
        <motion.div
          ref={textBox}
          initial={settled ? false : away}
          animate={shown === "waiting" ? away : shown === "intro" ? alone : rest}
          transition={
            shown === "split" ? { duration: 0.55, ease: EASE_IN_OUT } : { duration: 0.35, ease: EASE_OUT }
          }
        >
          {text}
        </motion.div>
        {below ? (
          <motion.div
            initial={settled ? false : { opacity: 0, y: 12 }}
            animate={before ? { opacity: 0, y: 12 } : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE_OUT, delay: 0.15 }}
          >
            {below}
          </motion.div>
        ) : null}
      </div>
      <motion.div
        data-section-scene=""
        className={cn(
          "mt-8 flex min-w-0 justify-center lg:mt-0 lg:flex-1",
          side === "start" ? "lg:stage-bleed-end" : "lg:stage-bleed-start",
        )}
        initial={settled ? false : windowAway}
        animate={before ? windowAway : { opacity: 1, x: 0, y: 0 }}
        transition={{ duration: 0.55, ease: EASE_OUT, delay: 0.05 }}
        onAnimationComplete={() => {
          if (phase === "split") setPhase("landed");
        }}
      >
        <div ref={fit} className="w-full lg:stage-window">
          {scene(shown !== "landed")}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * A feature section's piece under its text. Under lg it is the stacked anatomy's 176px box; from lg
 * the piece still lays itself out in its 288px box, drawn at 0.8 inside a 224px slot so the text
 * column fits a 720px-high view. The box is 125% of the column, so at 0.8 it spans the column exactly.
 */
export function StagePiece({ children }: { children: ReactNode }) {
  return (
    <div data-section-piece="" className="relative mt-8 h-44 lg:mt-6 lg:h-56">
      <div className="relative size-full lg:absolute lg:-inset-x-1/8 lg:top-1/2 lg:h-72 lg:w-auto lg:-translate-y-1/2 lg:scale-80">
        {children}
      </div>
    </div>
  );
}
