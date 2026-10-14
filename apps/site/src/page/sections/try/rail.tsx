import type { ReactNode } from "react";
import { cn } from "../../../shared/cn";
import { code } from "../../layout/type";

/**
 * The hero demo's beats, in its script's order (`hero.scene.tsx` reports them by index), then the
 * visitor's own: the last step lights when the editor is handed over.
 */
const STEPS: { id: string; text: ReactNode }[] = [
  {
    id: "keyword",
    text: (
      <>
        <Keys>gro</Keys> then accept <Keys>group by</Keys>
      </>
    ),
  },
  {
    id: "column",
    text: (
      <>
        <Keys>s.</Keys> then pick a column
      </>
    ),
  },
  {
    id: "run",
    text: (
      <>
        <Keys>⌘↵</Keys> runs it
      </>
    ),
  },
  { id: "yours", text: "Now you: click in and edit" },
];

/** The step the visitor's turn is. */
export const YOUR_STEP = STEPS.length - 1;

function Keys({ children }: { children: ReactNode }) {
  return <kbd className={cn(code, "rounded-sm bg-secondary px-1.5 py-0.5 text-sm")}>{children}</kbd>;
}

/** On a phone the editor is never handed over, so the visitor's step points them to a computer. */
const WATCH_ONLY_STEP = "Try it yourself on a computer";

/**
 * A tutorial rail beside the window, lit in step with the demo: `at` is the step playing, -1 before
 * it starts. `watchOnly` for a phone's window, whose demo loops and stays the demo's.
 */
export function TryRail({ at, watchOnly = false }: { at: number; watchOnly?: boolean }) {
  return (
    <ol aria-label="What the demo does" className="mt-8 flex flex-col gap-3 lg:mt-10">
      {STEPS.map((step, i) => (
        <li
          key={step.id}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex items-center gap-3 text-base transition-colors duration-500",
            i === at ? "text-foreground" : i < at ? "text-muted-foreground" : "text-muted-foreground/60",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full transition-colors duration-500",
              i === at ? "bg-glaze" : i < at ? "bg-muted-foreground" : "ring-1 ring-muted-foreground/60 ring-inset",
            )}
          />
          <span>{watchOnly && i === YOUR_STEP ? WATCH_ONLY_STEP : step.text}</span>
        </li>
      ))}
    </ol>
  );
}
