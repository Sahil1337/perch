// The pass/fail mark, which means the same thing everywhere it appears: this row got through, that
// one did not. WHERE stamps it on a row it has just tested; the per-row ledger and the grid stamp it
// on an outer row the subquery has just answered for.
//
// Whether it ARRIVES is the caller's business. A station that is testing rows as the reader watches
// delays each mark by that row's turn; a card that came on screen already settled passes `settled`
// and the mark is simply there, because nothing happened to it while anyone was looking.

import type * as React from "react";
import { cn } from "../../lib/utils";

export function VerdictMark({
  verdict,
  delayMs,
  settled,
}: {
  readonly verdict?: "pass" | "fail";
  readonly delayMs: number;
  readonly settled?: boolean;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 items-center justify-center rounded-full text-white",
        !settled && "transition-opacity delay-(--d) duration-200",
        verdict ? "opacity-100" : "opacity-0",
        verdict === "fail" ? "bg-destructive" : "bg-success",
      )}
      style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
    >
      {verdict === "fail" ? (
        <svg height="8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 8 8" width="8">
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
        </svg>
      ) : (
        <svg
          fill="none"
          height="8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          viewBox="0 0 8 8"
          width="8"
        >
          <path d="M1.5 4.2l1.8 1.8 3.2-3.8" />
        </svg>
      )}
    </span>
  );
}
