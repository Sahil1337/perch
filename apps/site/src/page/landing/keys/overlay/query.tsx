import type { ReactNode } from "react";
import { cn } from "../../../../shared/cn";
import { QUERY } from "../data";

/** How far the query has got. */
export type Beat = {
  /** Characters of `join sp` typed. */
  typed: number;
  /** Tab took the completion. */
  completed: boolean;
  /** Characters of the ON clause written. */
  on: number;
  menu: boolean;
  /** The ON clause is still marked as the foreign key's suggestion. */
  fk: boolean;
  ran: boolean;
};

export const START: Beat = { typed: 0, completed: false, on: 0, menu: false, fk: false, ran: false };
export const END: Beat = {
  typed: QUERY.typed.length,
  completed: true,
  on: QUERY.on.length,
  menu: false,
  fk: false,
  ran: true,
};

function Kw({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function Caret({ blink }: { blink: boolean }) {
  return (
    <span className="relative inline-block w-0 align-top">
      <span
        className={cn(
          "absolute top-0 left-0 h-lh w-0.5 bg-info-foreground motion-reduce:animate-none",
          blink && "animate-keys-caret",
        )}
      />
    </span>
  );
}

// The app's completion popup, at the size of this type: kind glyph, the label with the typed
// prefix in weight and blue, the detail pinned right.
function Menu() {
  const rows = [
    { glyph: "▦", label: "species", detail: "table · ~51 rows" },
    { glyph: "▨", label: "species_totals", detail: "view" },
  ];
  return (
    <div
      data-menu
      className="absolute top-full left-0 z-20 mt-2 w-max animate-keys-pop rounded-lg border border-border bg-popover p-1 font-mono text-sm/6 tracking-normal text-popover-foreground shadow-lg shadow-background/60"
    >
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={cn("flex items-center gap-2 rounded-sm px-2 py-0.5", i === 0 && "bg-accent text-accent-foreground")}
        >
          <span className="w-4 text-center text-info-foreground">{row.glyph}</span>
          <span>
            <span className="font-semibold text-info-foreground">{row.label.slice(0, 2)}</span>
            {row.label.slice(2)}
          </span>
          <span className={cn("ml-auto pl-6 text-muted-foreground", i === 0 && "text-accent-foreground/65")}>
            {row.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The scene's caption: the query, in mono a size under the heading's. The first line is already
 * written; the bird types the second, and the third writes itself from the foreign key. Every line
 * holds its room from the first paint.
 */
export function Query({ beat, blink }: { beat: Beat; blink: boolean }) {
  const typed = QUERY.typed.slice(0, beat.typed);
  const prefix = typed.slice(5);
  const onText = QUERY.on.slice(0, beat.on);
  const caretOnThird = beat.completed && beat.on > 0;
  return (
    <div aria-hidden className="font-mono text-2xl/8 tracking-tight text-foreground">
      <div className="whitespace-pre">
        <Kw>select</Kw> <span className="text-muted-foreground/60">…</span> <Kw>from</Kw> sightings g
      </div>
      <div className="whitespace-pre">
        {typed.length >= 4 ? <Kw>join</Kw> : typed}
        {typed.length > 4 && " "}
        {beat.completed ? (
          <>
            {QUERY.completion}
            {QUERY.alias}
          </>
        ) : (
          <span className="relative">
            {prefix}
            {beat.menu && <Menu />}
          </span>
        )}
        {!caretOnThird && <Caret blink={blink} />}
      </div>
      <div className="whitespace-pre">
        {"  "}
        <span className="relative">
          {/* blue at once while the foreign key writes it, then a slow settle to ink */}
          <span className={cn(beat.fk ? "text-info-foreground" : "text-foreground transition-colors duration-700")}>
            {beat.fk ? (
              onText
            ) : (
              <>
                {onText.startsWith("on") ? <Kw>on</Kw> : onText.slice(0, 2)}
                {onText.slice(2)}
              </>
            )}
          </span>
          {caretOnThird && <Caret blink={blink} />}
          <span
            className={cn(
              "absolute top-full left-0 font-mono text-sm/6 tracking-normal text-muted-foreground transition-opacity duration-500",
              beat.fk && beat.on === QUERY.on.length ? "opacity-100" : "opacity-0",
            )}
          >
            ◇ foreign key · sightings.species_id → species.id
          </span>
        </span>
      </div>
    </div>
  );
}
