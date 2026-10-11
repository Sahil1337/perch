import { type Ref, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { type Point, seededRandom } from "../../math";
import { ARRIVALS, TOTAL_BIRDS, type Arrival } from "../data";
import { arc, flutter } from "./slip-flights";

/** Where the kept slips stack, in the stage's px: the first slip's top-left, then one row per `gap`. */
export type Stack = { x: number; y: number; gap: number; count: number };

export type SlipsHandle = {
  /** Every row flies out of `from`; the stack's count settle, the rest flutter down and away. */
  burst(from: Point): Promise<void>;
  /** Straight to the settled stack, for reduced motion or a visitor who scrolled past the intro. */
  settle(): void;
  /** Slides the whole stack, for the scroll hand-over. */
  shift(x: number, y: number, opacity: number): void;
};

// A kept row is turned a hair, one of five ways, so the stack reads as paper.
const tilt = (i: number) => ((i * 7) % 5) - 2;
// Seeded, so the burst is the same on every visit.
const SEED = 33;

function place(el: HTMLElement, x: number, y: number, r: number) {
  el.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg)`;
}

// A kept row's place in the stack, a hair off the column.
function home(stack: Stack, i: number) {
  return { x: stack.x + (((i * 5) % 3) - 1) * 3, y: stack.y + i * stack.gap, r: tilt(i) * 0.6 };
}

function showCaption(el: HTMLElement | null, stack: Stack, animate: boolean) {
  if (!el) return;
  place(el, stack.x, stack.y + stack.count * stack.gap + 4, 0);
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: animate ? 600 : 0, delay: animate ? 700 : 0, fill: "both" });
}

function Slip({ row, slipRef }: { row: Arrival; slipRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={slipRef}
      className="absolute top-0 left-0 flex w-60 items-baseline gap-3 rounded-xs border-b border-keys-paper-edge bg-keys-paper px-2.5 py-1 font-mono text-xs/5 text-keys-paper-ink opacity-0 shadow-md shadow-background/70"
    >
      <span className="truncate">{row.name}</span>
      <span className="ml-auto text-keys-paper-muted">{row.seen}</span>
      <span className="w-8 text-right tabular-nums">{row.birds}</span>
    </div>
  );
}

/**
 * The query's rows as paper slips. The ones that stay are drawn over the sculpture; the rest are
 * drawn behind it, so as they flutter down they pass behind the keys. Once out, the stack follows
 * `stack` when the landing changes size.
 */
export function Slips({ ref, stack }: { ref: Ref<SlipsHandle>; stack: Stack }) {
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const slips = useRef<(HTMLDivElement | null)[]>([]);
  const caption = useRef<HTMLParagraphElement>(null);
  const out = useRef(false);

  // Straight to the stack: every animation dropped, the kept rows in place, the rest gone.
  const rest = useCallback((to: Stack) => {
    out.current = true;
    slips.current.forEach((el, i) => {
      if (!el) return;
      for (const a of el.getAnimations()) a.cancel();
      if (i < to.count) {
        const end = home(to, i);
        place(el, end.x, end.y, end.r);
        el.style.opacity = "1";
      } else el.style.opacity = "0";
    });
    showCaption(caption.current, to, false);
  }, []);

  useLayoutEffect(() => {
    if (out.current) rest(stack);
  }, [stack, rest]);

  useImperativeHandle(
    ref,
    () => ({
      burst(from) {
        out.current = true;
        const rand = seededRandom(SEED);
        const runs: Promise<unknown>[] = [];
        slips.current.forEach((el, i) => {
          if (!el) return;
          const x0 = from.x - el.offsetWidth / 2;
          const y0 = from.y - 14;
          if (i < stack.count) {
            runs.push(el.animate(arc(x0, y0, home(stack, i), rand), { duration: 1100 + i * 55, delay: 60 + i * 30, easing: "linear", fill: "both" }).finished);
            return;
          }
          const n = i - stack.count;
          const { frames, seconds } = flutter(x0, y0, n % 2 ? 1 : -1, rand);
          el.animate(frames, { duration: seconds * 1000, delay: n * 18, easing: "linear", fill: "both" });
        });
        showCaption(caption.current, stack, true);
        return Promise.all(runs).then(() => undefined);
      },
      settle() {
        rest(stack);
      },
      shift(x, y, opacity) {
        for (const layer of [front.current, back.current]) {
          if (!layer) continue;
          layer.style.transform = `translate(${x}px, ${y}px)`;
          layer.style.opacity = String(opacity);
        }
      },
    }),
    [stack, rest],
  );

  const slip = (row: Arrival, i: number) => (
    <Slip
      key={row.name}
      row={row}
      slipRef={(el) => {
        slips.current[i] = el;
      }}
    />
  );
  return (
    <>
      <div ref={back} aria-hidden className="pointer-events-none absolute inset-0 -z-20">
        {ARRIVALS.map((row, i) => (i >= stack.count ? slip(row, i) : null))}
      </div>
      <div ref={front} aria-hidden className="pointer-events-none absolute inset-0">
        {ARRIVALS.map((row, i) => (i < stack.count ? slip(row, i) : null))}
        <p ref={caption} className="absolute top-0 left-0 font-mono text-xs/5 text-muted-foreground opacity-0">
          {ARRIVALS.length} rows · {TOTAL_BIRDS.toLocaleString("en-GB")} birds
        </p>
      </div>
    </>
  );
}
