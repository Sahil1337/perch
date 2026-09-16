"use client";

// The parts of the query that got no section, listed where they can be found but not where they
// interrupt. A piece of SQL that quietly vanished from a visualiser is the worst failure this
// screen has: the reader believes they have seen the whole query. Collapsed is fine; absent is not.

import { ChevronRightIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { highlightSql } from "../sql-editor/highlight-sql";
import type { SkippedPart } from "./program";

/** Why it has no section, in the reader's terms rather than the builder's. */
function why(part: SkippedPart): string {
  return part.why === "unsupported"
    ? "could not be read"
    : "left where it is, inside the query above";
}

export function SkippedNote({ parts }: { parts: readonly SkippedPart[] }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger render={<Button size="xs" variant="ghost" />}>
        <ChevronRightIcon className={cn("transition-transform duration-200", open && "rotate-90")} />
        {parts.length === 1
          ? "1 part of this query has no section of its own"
          : `${parts.length} parts of this query have no section of their own`}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="flex max-h-56 flex-col gap-3 overflow-y-auto px-2 pt-2 pb-1">
          {parts.map((part, i) => (
            <li className="min-w-0" key={`${part.label}:${i}`}>
              <p className="text-xs">
                <span className="font-mono">{part.label}</span>
                <span className="text-muted-foreground"> — {why(part)}</span>
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs leading-5">{part.reason}</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs leading-5">
                {highlightSql(part.sql)}
              </pre>
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
