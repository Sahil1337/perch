// Perch's identity, in one place. Two surfaces were drawing their own bird before this file
// existed — the onboarding beam and the server gate — and they did not agree, which is the
// failure mode a logo exists to prevent.
//
// Drawn rather than imported, for the same reason `dialect-mark.tsx` gives: an icon set is there
// for UI affordances, and identity is not an affordance. It also means the mark is a few hundred
// bytes of markup that inherits the theme, rather than an asset that has to be shipped twice for
// light and dark.

import type React from "react";
import { cn } from "../lib/utils";

/**
 * Perch's own mark: a bird on a branch. A drawing, not a logo, and — on any screen with room for
 * it — never without the name beside it; see `PerchLogo`.
 *
 * Songbird proportions, drawn to survive being small: a head about 45% of the body, a short
 * conical beak, a folded-wing back and a narrow fanned tail. Same 24px box and 1.5 stroke as
 * `DialectMark`, so the two ends of the onboarding beam match.
 *
 * Every part is still distinguishable at 20px. At 16px it reduces to a recognisable bird on a
 * branch, and below that it stops working — use the filled tile in `apps/web/app/icon.svg`.
 */
export function PerchMark({ className }: { className?: string } = {}): React.ReactElement {
  return (
    <svg
      aria-hidden
      className={cn("size-5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* the branch */}
      <path d="M3 20h18" />
      {/* Two plain tarsi, 3.2 apart and angled back so the feet land under the bird's centre of
          mass, the way a settled bird stands. They were closer together with a toe curled over the
          branch, which at 24px merged them into one post and lumped the branch. */}
      <path d="M11.4 17L11 20M14.6 17L14.2 20" />
      {/* One closed outline for the whole bird, run once: beak tip, upper beak, crown, nape, back,
          the tail's upper edge out to its squared end, back along its lower edge, undertail, belly,
          breast, throat, chin — and Z closes the lower beak. A single path is what keeps the beak
          and tail part of the animal instead of two lines meeting a blob, which is what the mark
          this replaced looked like at any size worth reading. */}
      <path d="M20.5 8.2L18.3 7.2C17.8 5.3 15.5 4.4 14 5.6C13.2 6.2 12.4 6.5 11.6 7.2C10 8.6 9.6 10.85 7.9 12.2L3.95 15.3L5.55 17.35L9.3 14C10.3 15.6 13.8 18 16.2 15.6C17.6 14.2 18.4 12 18.3 10.5C18.2 9.6 18.4 9 18.6 8.9Z" />
      {/* the eye, set back from the beak so it stays a separate dot rather than merging into the
          face. Below about 24px it closes up anyway, which is the floor for this mark. */}
      <circle cx="16.4" cy="6.9" fill="currentColor" r=".65" stroke="none" />
    </svg>
  );
}

/**
 * The mark in the rounded chip it wears when it is standing on its own — the server gate, the
 * empty states, anywhere the bird would otherwise float unanchored in the middle of a screen.
 */
export function PerchBadge({ className }: { className?: string } = {}): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card",
        className,
      )}
    >
      <PerchMark className="size-5" />
    </span>
  );
}

/**
 * Mark plus wordmark. The name is lowercase everywhere it is a command — `perch` in a terminal,
 * `@perch/*`, `~/.perch` — and capitalised everywhere it is the product, which is here.
 *
 * It carries the accessible name for both halves: the mark is `aria-hidden` and the word is text,
 * so a screen reader gets "Perch" once rather than twice.
 */
export function PerchLogo({
  className,
  markClassName,
}: { className?: string; markClassName?: string } = {}): React.ReactElement {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <PerchMark className={cn("size-5", markClassName)} />
      {/* Tracked in: at this size the default spacing reads as letters rather than a word. */}
      <span className="font-medium text-base text-foreground leading-none tracking-tight">
        Perch
      </span>
    </span>
  );
}
