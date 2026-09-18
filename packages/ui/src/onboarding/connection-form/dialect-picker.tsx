import type { Dialect } from "@perch/protocol";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { DIALECT_LABEL, DialectMark } from "../dialect-mark";

const DIALECTS: readonly Dialect[] = ["postgres", "mysql"];

/** The two marks, as a pair of pressable cards. The first-run screen draws the same two. */
export function DialectPicker({
  value,
  onChange,
}: {
  value: Dialect;
  onChange: (dialect: Dialect) => void;
}): React.ReactElement {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-medium text-sm">Server</legend>
      <div className="grid grid-cols-2 gap-2">
        {DIALECTS.map((option) => (
          <button
            aria-pressed={value === option}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              value === option
                ? "border-primary bg-accent text-foreground"
                : "border-border text-muted-foreground hover:bg-accent/50",
            )}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            <DialectMark dialect={option} />
            {DIALECT_LABEL[option]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
