import type { Ref } from "react";
import { cn } from "../../../shared/cn";
import { Slip, type SlipTilt } from "../../materials";
import { type Clause, PLACES } from "./clauses";
import { RollingCount } from "./rolling-count";

export type ClauseSlipProps = {
  clause: Clause;
  /** The rows the clause before it left, which its count ticks down from. */
  from: number;
  tilt: SlipTilt;
  /** A hair off the column, as the landing's kept slips sit. */
  shift: string;
  perchRef?: Ref<HTMLElement>;
};

/**
 * One clause on its own slip: the clause at the left, the rows that survive it at the right. Under
 * lg only the rail's label fits; from lg the clause is printed as written.
 */
export function ClauseSlip({ clause, from, tilt, shift, perchRef }: ClauseSlipProps) {
  return (
    <Slip
      data-clause=""
      tilt={tilt}
      className={cn(
        "relative flex w-40 items-center gap-3 px-2 py-0.5 text-xs/3.5 not-first:-mt-0.5 lg:w-108 lg:px-2.5 lg:py-1 lg:text-xs/5 lg:not-first:mt-0.5",
        shift,
      )}
    >
      {perchRef ? <span ref={perchRef} className="absolute inset-0" /> : null}
      <span className="w-16 shrink-0">{clause.label}</span>
      <span className="truncate text-paper-muted max-lg:hidden">{clause.text}</span>
      <span className="ml-auto flex shrink-0 gap-1">
        <RollingCount from={from} to={clause.rows} places={PLACES} />
        <span className="text-paper-muted">rows</span>
      </span>
    </Slip>
  );
}
