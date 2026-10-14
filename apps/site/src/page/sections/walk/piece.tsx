import { type Ref, useRef } from "react";
import { type SlipTilt, useLoop } from "../../materials";
import { ClauseSlip } from "./clause-slip";
import { CLAUSES } from "./clauses";
import { walkLoop } from "./loop";

// Each slip's hair of a turn and its few px off the column. Neighbours never turn opposite ways,
// so the tight stack under lg never brings one slip's print onto the next.
const TILTS: SlipTilt[] = [0, -1, 0, 1, 0, -1, 0, 1];
const SHIFTS = ["", "translate-x-0.75", "-translate-x-0.75", "", "translate-x-0.75", "", "-translate-x-0.75", ""];

/**
 * The SELECT from the walk scene as a stack of slips, one per clause in the order the walk takes
 * them, each landing on the last with the rows that survive it ticking down from the count before.
 * The bird stands on FROM, the slip the stack starts from. Under lg the stack starts low enough to
 * keep the bird clear of the body text above the slot.
 */
export function WalkPiece({ perchRef }: { perchRef: Ref<HTMLElement> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLoop(ref, walkLoop);
  return (
    <div ref={ref} aria-hidden className="flex size-full justify-center pt-8 lg:items-center lg:pt-0">
      <div className="flex flex-col">
        {CLAUSES.map((clause, i) => (
          <ClauseSlip
            key={clause.label}
            clause={clause}
            from={CLAUSES[i - 1]?.rows ?? clause.rows}
            tilt={TILTS[i % TILTS.length] ?? 0}
            shift={SHIFTS[i % SHIFTS.length] ?? ""}
            perchRef={i === 0 ? perchRef : undefined}
          />
        ))}
      </div>
    </div>
  );
}
