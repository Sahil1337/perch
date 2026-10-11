// The clause rail under the Query Walk scene: every clause of a SELECT in the order the database
// reads them, lit where the real walk is. It reads the walk's own station rail out of the DOM, so it
// never holds a position of its own that could drift from the one on screen. It only follows: like
// the window above it, it takes no pointer or key. Light: nothing here imports @perch/ui.

import * as React from "react";
import { cn } from "../../cn";

export const CLAUSES = [
  "FROM",
  "JOIN",
  "WHERE",
  "GROUP BY",
  "HAVING",
  "WINDOW",
  "SELECT",
  "DISTINCT",
  "ORDER BY",
  "LIMIT",
] as const;

/** The walk's station buttons, one per station, in its own rail. */
export function stationButtons(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('nav[aria-label="Stations"] button')];
}

/** The chip a station belongs to: `JOIN 2` is a JOIN, and an OFFSET with no LIMIT is the cut. */
function clauseOf(button: Element): number {
  const label = (button.getAttribute("aria-label") ?? "").split(",")[0]?.trim() ?? "";
  const name = /^JOIN \d+$/.test(label) ? "JOIN" : label === "OFFSET" ? "LIMIT" : label;
  return (CLAUSES as readonly string[]).indexOf(name);
}

/** What the rail shows, as a string so an unchanged walk is an unchanged snapshot. */
function readWalk(app: HTMLElement | null): string {
  const buttons = app ? stationButtons(app) : [];
  if (buttons.length === 0) return "";
  const used = new Set<number>();
  let active = -1;
  for (const button of buttons) {
    const clause = clauseOf(button);
    if (clause < 0) continue;
    if (!button.getAttribute("aria-label")?.endsWith(", not in this query")) used.add(clause);
    if (button.getAttribute("aria-current") === "step") active = clause;
  }
  const dots = [
    ...(app?.querySelectorAll('aside[aria-label="Narrator"] button[aria-label^="Step "]') ?? []),
  ];
  const at = dots.findIndex((dot) => dot.getAttribute("aria-current") === "step");
  const progress = at >= 0 ? (at + 1) / dots.length : 1;
  return JSON.stringify({ active, used: [...used].sort((a, b) => a - b), progress });
}

type Reading = { active: number; used: number[]; progress: number };

/** The walk's position, live. Mutations are folded into one read a frame. */
function useWalkReading(app: HTMLElement | null): Reading | null {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (!app) return () => {};
      let frame = 0;
      const observer = new MutationObserver(() => {
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            onChange();
          });
        }
      });
      observer.observe(app, {
        attributes: true,
        attributeFilter: ["aria-current", "aria-label"],
        childList: true,
        subtree: true,
      });
      return () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
      };
    },
    [app],
  );
  const snapshot = React.useSyncExternalStore(
    subscribe,
    () => readWalk(app),
    () => "",
  );
  return React.useMemo(() => (snapshot ? (JSON.parse(snapshot) as Reading) : null), [snapshot]);
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The rail. Before the walk has loaded every chip is neutral and nothing is lit; the chips take
 * the same room either way, so nothing moves when it arrives.
 */
export function WalkRail({
  app,
  railRef,
}: {
  /** The window's app area the walk is drawn in; null until the window is up. */
  app: HTMLElement | null;
  /** The rail's root, the scene's `rail` anchor. */
  railRef: React.RefObject<HTMLDivElement | null>;
}): React.ReactElement {
  const reading = useWalkReading(app);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const lineRef = React.useRef<HTMLSpanElement>(null);
  const chips = React.useRef<(HTMLSpanElement | null)[]>([]);
  const active = reading?.active ?? -1;

  const edges = React.useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const hidden = rail.scrollWidth - rail.clientWidth;
    rail.toggleAttribute("data-more-left", hidden > 1 && rail.scrollLeft > 1);
    rail.toggleAttribute("data-more-right", hidden > 1 && rail.scrollLeft < hidden - 1);
  }, [railRef]);

  // The underline under the lit chip, measured rather than laid out, so it can slide between chips
  // of different widths. The first placement lands without sliding in from the left edge.
  React.useLayoutEffect(() => {
    const line = lineRef.current;
    const track = trackRef.current;
    if (!line || !track) return;
    const place = (): void => {
      const chip = chips.current[active];
      if (!chip) {
        line.removeAttribute("data-placed");
        return;
      }
      line.style.setProperty("--rail-x", `${chip.offsetLeft + 10}px`);
      line.style.setProperty("--rail-w", `${Math.max(0, chip.offsetWidth - 20)}px`);
      if (!line.hasAttribute("data-placed")) {
        line.getBoundingClientRect();
        line.setAttribute("data-placed", "");
      }
      edges();
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(track);
    return () => observer.disconnect();
  }, [active, edges]);

  // Keep the lit chip in view when the rail is narrower than its chips, by scrolling the rail alone,
  // never the page.
  React.useEffect(() => {
    const rail = railRef.current;
    const chip = chips.current[active];
    if (!rail || !chip || rail.scrollWidth <= rail.clientWidth + 1) return;
    rail.scrollTo({
      left: chip.offsetLeft + chip.offsetWidth / 2 - rail.clientWidth / 2,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [active, railRef]);

  return (
    // A mirror of the walk inside the window, which is out of reach of assistive tech the same way.
    <div
      aria-hidden
      className="pointer-events-none relative mt-5 overflow-x-auto overflow-y-hidden select-none data-more-left:mask-l-from-90% data-more-right:mask-r-from-90%"
      data-walk-rail=""
      onScroll={edges}
      ref={railRef}
    >
      <div className="relative w-full min-w-max pb-2" ref={trackRef}>
        <ol className="flex items-center">
          {CLAUSES.map((clause, i) => {
            const unused = reading !== null && !reading.used.includes(i);
            const current = i === active;
            const passed = reading !== null && active >= 0 && i < active;
            return (
              <React.Fragment key={clause}>
                {i > 0 && (
                  <li
                    aria-hidden
                    className={cn(
                      "flex min-w-5.5 flex-1 items-center px-1 transition-colors duration-300 motion-reduce:transition-none",
                      i <= active ? "text-info/60" : "text-foreground/20",
                    )}
                  >
                    <span className="h-px flex-1 bg-current" />
                    <svg className="-ml-px h-2 w-1.25 flex-none" fill="none" viewBox="0 0 5 8">
                      <path
                        d="M.75.75 4 4 .75 7.25"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.1"
                      />
                    </svg>
                  </li>
                )}
                <li className="flex items-center">
                  <span
                    className={cn(
                      "relative flex-none whitespace-nowrap rounded-md px-2.5 py-1.75 font-mono text-sm leading-none transition-colors duration-300 motion-reduce:transition-none",
                      unused
                        ? "text-muted-foreground/50"
                        : current
                          ? "bg-muted text-foreground"
                          : passed
                            ? "text-foreground/70"
                            : "text-muted-foreground",
                    )}
                    ref={(chip) => {
                      chips.current[i] = chip;
                    }}
                  >
                    {clause}
                  </span>
                </li>
              </React.Fragment>
            );
          })}
        </ol>
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0.5 left-0 h-0.5 w-(--rail-w) translate-x-(--rail-x) overflow-hidden rounded-full bg-info/30 opacity-0 data-placed:opacity-100 data-placed:transition-all data-placed:duration-500 data-placed:ease-out motion-reduce:transition-none"
          ref={lineRef}
        >
          <span
            className="absolute inset-0 origin-left scale-x-(--rail-fill) bg-info transition-transform duration-700 ease-out motion-reduce:transition-none"
            key={active}
            style={{ "--rail-fill": String(reading?.progress ?? 0) } as React.CSSProperties}
          />
        </span>
      </div>
    </div>
  );
}
