// What produced these results.
//
// Rendered only for a run opened from History; see the call site. When you pressed Run the query is
// in the editor directly above and this would be the pane repeating it back. From History it is the
// only answer there is: you clicked a time and a row count in a 180px sidebar, the pane filled with
// rows, and nothing on screen said which query they belonged to.
//
// One line, because that is what a `select … from … where …` needs nine times out of ten, and a
// chevron for the tenth. Collapsed it truncates; open it wraps and scrolls, capped so a 200-line
// migration cannot take the pane over.

import { ChevronRightIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";

/** Collapsed height: one line of the pane's monospace, the same as the header above it. */
export function QueryLine({ sql }: { sql: string }): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const text = sql.trim();
  if (text === "") return null;

  // A query that is one short line has nothing to expand to, so it does not offer to.
  const multiline = text.includes("\n") || text.length > 80;

  return (
    <div className="flex shrink-0 items-start gap-1 border-border border-b px-2 py-1">
      {multiline ? (
        <button
          aria-expanded={open}
          aria-label={open ? "Collapse the query" : "Show the whole query"}
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((previous) => !previous)}
          type="button"
        >
          <ChevronRightIcon
            className={cn("size-3 transition-transform duration-200", open && "rotate-90")}
          />
        </button>
      ) : (
        <span aria-hidden className="size-4 shrink-0" />
      )}
      <pre
        className={cn(
          "min-w-0 flex-1 font-mono text-muted-foreground text-xs leading-5",
          open ? "max-h-32 overflow-auto whitespace-pre-wrap" : "truncate",
        )}
        // The whole query, for the nine times in ten that the tooltip is enough.
        title={multiline && !open ? text : undefined}
      >
        {open ? text : text.replace(/\s+/g, " ")}
      </pre>
    </div>
  );
}
