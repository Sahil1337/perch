import { cn } from "../../../shared/cn";
import { Slip } from "../../materials";
import { Highlight } from "./highlight";
import { PICK, TABLES } from "./offers";

/** The tables the popup offers after JOIN, on a slip that unfolds down from under the keys. */
export function TablesSlip({ className }: { className?: string }) {
  return (
    <Slip data-part="tables" tilt={-1} className={cn("origin-top p-1 text-xs/4 sm:p-1.5 lg:p-2 lg:text-sm/5", className)}>
      <ul>
        {TABLES.map((table, i) => (
          <li key={table.name} className="relative flex items-baseline gap-4 px-1.5">
            {i === PICK ? <Highlight part="tables-highlight" /> : null}
            <span className="relative">{table.name}</span>
            <span className="relative ml-auto text-paper-muted max-sm:hidden">{table.detail}</span>
          </li>
        ))}
      </ul>
    </Slip>
  );
}
