"use client";

// Shared row and field primitives for the settings panes: a label-and-control row, and the one
// numeric field every pane with a byte/row/timeout limit needs.

import * as React from "react";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../ui/input-group";

/**
 * Every control in a settings row is this wide, so they share one column down the right edge: the
 * control's box is what the eye follows, and sizing each to its content reads as a list that failed
 * to line up. Units go inside the field for the same reason.
 */
export const CONTROL_W = "w-28";

export function SettingRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description?: string;
  htmlFor?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label className="font-medium text-sm" htmlFor={htmlFor}>
          {title}
        </label>
        {description !== undefined && (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * A number that is only worth writing once it is a number: clearing "1000" to type "5000" would send
 * `maxRows: 1` on the way, and the server would take it. The field keeps its own text, clamps on
 * blur or Enter, and snaps back to what was stored.
 */
export function NumberSetting({
  id,
  value,
  min,
  max,
  unit,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  /** Rendered inside the field, at its trailing edge, so the box stays in the column. */
  unit?: string;
  onCommit: (next: number) => void;
}): React.ReactElement {
  const [text, setText] = React.useState(String(value));
  const [editing, setEditing] = React.useState(false);

  // Mirrors the stored value while not being edited, so a failed write or an outside change shows.
  if (!editing && text !== String(value)) setText(String(value));

  function commit(): void {
    setEditing(false);
    const parsed = Number(text.trim());
    const next = Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), min), max) : value;
    setText(String(next));
    if (next !== value) onCommit(next);
  }

  const field = {
    id,
    inputMode: "numeric" as const,
    onBlur: commit,
    onFocus: () => setEditing(true),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commit();
    },
    onValueChange: setText,
    size: "sm" as const,
    value: text,
  };

  if (unit === undefined) return <Input className={CONTROL_W} {...field} />;

  return (
    <InputGroup className={CONTROL_W}>
      <InputGroupInput {...field} />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{unit}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}
