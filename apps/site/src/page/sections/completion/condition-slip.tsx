import { Slip } from "../../materials";
import { Highlight } from "./highlight";
import { CONDITION } from "./offers";

/** The join condition the app offered after ON, already selected, and where it came from. */
export function ConditionSlip({ className }: { className?: string }) {
  return (
    <Slip data-part="condition" tilt={1} className={className}>
      <div className="p-1 text-xs/4 sm:p-1.5 lg:p-2 lg:text-sm/5">
        <p className="relative px-1.5">
          <Highlight />
          <span className="relative">{CONDITION.text}</span>
        </p>
        <p className="px-1.5 text-paper-muted">{CONDITION.detail}</p>
      </div>
    </Slip>
  );
}
