import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import type { DraftField, DraftProblem } from "./trigger-sql";

/** One field of the form: its label in a narrow column, the control and its notes beside it. */
export function FormRow({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  label: string;
}): React.ReactElement {
  return (
    <div className="flex gap-3">
      <label className="w-20 shrink-0 pt-1.5 text-muted-foreground text-xs" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">{children}</div>
    </div>
  );
}

/** A line under a control: what a choice means, or, as a warning, what else it changes. */
export function FormHint({
  children,
  warn = false,
}: {
  children: React.ReactNode;
  warn?: boolean;
}): React.ReactElement {
  const Icon = warn ? TriangleAlertIcon : InfoIcon;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        warn ? "text-warning-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** What stops the form saving, said under the field it's about. */
export function FieldProblems({
  field,
  problems,
}: {
  field: DraftField;
  problems: readonly DraftProblem[];
}): React.ReactElement | null {
  const mine = problems.filter((problem) => problem.field === field);
  if (mine.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5" role="alert">
      {mine.map((problem) => (
        <p className="text-destructive-foreground text-xs" key={problem.message}>
          {problem.message}
        </p>
      ))}
    </div>
  );
}
