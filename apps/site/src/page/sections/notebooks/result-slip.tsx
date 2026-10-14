import { cn } from "../../../shared/cn";
import { Slip, type SlipTilt } from "../../materials";
import type { Cell } from "./notebook";

/** Neighbouring slips lean opposite ways, as paper does when it comes out one sheet after another. */
const TILTS: SlipTilt[] = [1, -1];

/**
 * A cell's result, printed on its own slip. It lies under the strip and sticks out beside its cell,
 * pivoting on the end still under the paper. Under lg there is room for the first row only.
 */
export function ResultSlip({ cell, index }: { cell: Cell; index: number }) {
  return (
    <Slip
      data-result={index}
      tilt={TILTS[index % TILTS.length]}
      className="absolute top-0 left-full -z-10 -ml-2 w-max origin-left py-0.5 pr-2 pl-4 text-sm/5 tabular-nums lg:py-1"
    >
      <table>
        <tbody>
          {cell.rows.map((row, r) => (
            <tr key={row.join(" ")} className={cn(r > 0 && "hidden lg:table-row")}>
              {row.map((value, c) => (
                <td key={`${c}:${value}`} className={cn(c > 0 && "pl-3", cell.right[c] && "text-right")}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Slip>
  );
}
