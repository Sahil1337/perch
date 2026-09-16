"use client";

// The query walk: one SELECT, animated through each logical station with the real rows and counts
// the connected database gives back for every step. Walking into a CTE or subquery pushes a crumb;
// the crumbs at the top come back out.

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronRightIcon, XIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../../ui/button";
import { useWorkspace } from "../context";
import { parseSelect, type ParsedSelect, type SourceRef } from "./clauses";
import { WalkPlayer } from "./player";
import { sourceTitle } from "./steps";
import { useWalk, type Probe } from "./use-walk";

type Crumb = { readonly label: string; readonly sql: string };

export function QueryWalk({ sql }: { sql: string }): React.ReactElement {
  const { connection, database, probe } = useWorkspace();
  const dialect = connection?.dialect ?? "postgres";
  const [crumbs, setCrumbs] = React.useState<readonly Crumb[]>([{ label: "Query", sql }]);
  const current = crumbs[crumbs.length - 1]!;

  const parsed = React.useMemo(() => parseSelect(current.sql, dialect), [current.sql, dialect]);

  const walkInto = React.useCallback(
    (parent: ParsedSelect, source: SourceRef): void => {
      if (!source.body) return;
      const body = parent.text.slice(source.body.from, source.body.to).trim();
      // A CTE may lean on the ones declared before it; a subquery on all of them.
      const earlier =
        source.kind === "cte"
          ? parent.ctes.slice(
              0,
              parent.ctes.findIndex((cte) => cte.name === source.name),
            )
          : parent.ctes;
      const prefix =
        earlier.length > 0
          ? `with ${earlier.map((cte) => parent.text.slice(cte.range.from, cte.range.to)).join(",\n")}\n`
          : "";
      setCrumbs((previous) => [...previous, { label: sourceTitle(source), sql: `${prefix}${body}` }]);
    },
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg/5">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="font-medium text-sm leading-none">
            Query walk
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 truncate text-muted-foreground text-xs">
            {connection ? `${connection.name} · ${database ?? connection.database ?? ""}` : "No connection"}
            {" · "}How this SELECT runs, one clause at a time.
          </DialogPrimitive.Description>
        </div>
        {crumbs.length > 1 && (
          <nav aria-label="Walk path" className="flex min-w-0 items-center gap-0.5 text-xs">
            {crumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />}
                {i === crumbs.length - 1 ? (
                  <span className="truncate px-1 font-medium">{crumb.label}</span>
                ) : (
                  <Button
                    onClick={() => setCrumbs(crumbs.slice(0, i + 1))}
                    size="xs"
                    variant="ghost"
                  >
                    {crumb.label}
                  </Button>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <DialogPrimitive.Close aria-label="Close" render={<Button size="icon-sm" variant="ghost" />}>
          <XIcon />
        </DialogPrimitive.Close>
      </header>

      {parsed.kind === "unsupported" ? (
        <p className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm">
          {parsed.reason}
        </p>
      ) : !connection ? (
        <p className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm">
          Connect to a database to walk this query.
        </p>
      ) : (
        <Walk
          key={`${crumbs.length}:${current.sql}`}
          onWalk={(source) => walkInto(parsed, source)}
          parsed={parsed}
          probe={probe}
        />
      )}
    </div>
  );
}

function Walk({
  parsed,
  probe,
  onWalk,
}: {
  parsed: ParsedSelect;
  probe: Probe;
  onWalk: (source: SourceRef) => void;
}): React.ReactElement {
  const walk = useWalk(parsed, probe);
  return <WalkPlayer onWalk={onWalk} walk={walk} />;
}
