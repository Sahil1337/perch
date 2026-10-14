import { type Ref, useRef } from "react";
import { Keycap, ReturnGlyph, useLoop } from "../../materials";
import { ConditionSlip } from "./condition-slip";
import { completionLoop } from "./loop";
import { TablesSlip } from "./tables-slip";

const JOIN = ["J", "O", "I", "N"] as const;

// At the narrowest phones a medium key is a size down, so the keys and both slips fit side by side.
const NARROW = "max-sm:h-8 max-sm:min-w-8 max-sm:px-2";

/**
 * JOIN typed on porcelain keys, the tables the app offers unfolding beneath them related ones
 * first, ⏎ taking one; then ON, and the join condition it offers printed out from the foreign key.
 * The bird stands on ⏎ and rides it down. Two columns, keys over slips: JOIN over the tables, ⏎ over
 * the condition; under sm they spread to the slot's edges. Under lg the keys sit low enough to keep
 * the bird clear of the body text above the slot.
 */
export function CompletionPiece({ perchRef }: { perchRef: Ref<HTMLElement> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLoop(ref, completionLoop);
  return (
    <div ref={ref} aria-hidden className="flex size-full justify-center pt-8 lg:items-center lg:pt-0">
      <div className="grid w-full max-w-80 auto-cols-max items-start justify-between pr-1 sm:w-auto sm:max-w-none sm:justify-start sm:gap-x-4 sm:pr-0">
        <div className="relative z-10 col-start-1 row-start-1 ml-1.5 flex gap-1 lg:gap-1.5">
          {JOIN.map((letter) => (
            <span key={letter} data-key={letter} className="contents">
              <Keycap ink="ink" faceClassName={NARROW}>
                {letter}
              </Keycap>
            </span>
          ))}
        </div>
        <TablesSlip className="col-start-1 row-start-2" />
        <span data-key="return" className="relative z-10 col-start-2 row-start-1 flex">
          <Keycap topRef={perchRef} faceClassName={`${NARROW} px-3.5 lg:px-4.5`}>
            <ReturnGlyph className="h-2.5 w-4 lg:h-3 lg:w-5" />
          </Keycap>
        </span>
        <ConditionSlip className="col-start-2 row-start-2 mt-3 lg:mt-5" />
      </div>
    </div>
  );
}
