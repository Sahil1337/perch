"use client";

import type { QueryError, StatementResult } from "@perch/protocol";
import * as React from "react";
import { Badge } from "../../ui/badge";
import { type Run, runStatements } from "../types";
import { clockOf, commandLabel, plural, statementSummary } from "./format";

/** The log view: what the server said, in order, including the parts a grid cannot show. */
export function MessagesView({ run }: { run: Run }): React.ReactElement {
  const statements = runStatements(run);
  const started = clockOf(run.startedAt);

  return (
    <div className="h-full overflow-auto p-2.5 font-mono text-xs leading-5">
      <p className="text-muted-foreground">
        <span className="tabular-nums">[{started}]</span> Run started
        {run.database ? ` on ${run.database}` : ""}.
      </p>

      {statements.map((result) => (
        <React.Fragment key={result.index}>
          <p className="text-foreground">
            <span className="text-muted-foreground tabular-nums">[{result.index + 1}]</span>{" "}
            <span className="tabular-nums">{statementSummary(result)}</span>
            {result.truncated && (
              <span className="text-warning-foreground"> · truncated at the row limit</span>
            )}
          </p>
          {result.notices.map((notice, position) => (
            <p className="text-info-foreground" key={position}>
              {"  "}
              {notice}
            </p>
          ))}
        </React.Fragment>
      ))}

      {run.error && <ErrorBlock error={run.error} />}

      {run.status === "running" && (
        <p className="text-muted-foreground">
          <span className="tabular-nums">[{started}]</span> Waiting for the server…
        </p>
      )}

      {run.status === "cancelled" && <p className="text-muted-foreground">Run cancelled.</p>}

      {run.status === "done" && run.finishedAt && (
        <p className="text-muted-foreground">
          <span className="tabular-nums">[{clockOf(run.finishedAt)}]</span> Done
          {run.durationMs === undefined ? "" : ` in ${run.durationMs} ms`}.
        </p>
      )}
    </div>
  );
}

/** `detail` and `hint` are the two fields that usually say what to actually do about the error. */
function ErrorBlock({ error }: { error: QueryError }): React.ReactElement {
  return (
    <div className="mt-2 space-y-1 whitespace-pre-wrap rounded-md border border-destructive/32 bg-destructive/4 p-2.5 text-destructive-foreground">
      <p className="font-medium">
        {error.code ? `${error.code}: ` : ""}
        {error.message}
      </p>
      {error.line !== undefined && (
        <p className="text-muted-foreground tabular-nums">Line {error.line}</p>
      )}
      {error.detail && <p>{error.detail}</p>}
      {error.hint && <p className="text-muted-foreground">Hint: {error.hint}</p>}
    </div>
  );
}

/** A statement that changed rows instead of returning them, reported the way psql reports it. */
export function CommandOutcome({ result }: { result: StatementResult }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <Badge size="lg" variant="success">
        <span className="tabular-nums">{commandLabel(result)}</span>
      </Badge>
      <p className="text-muted-foreground text-xs tabular-nums">
        {result.affectedRows === null
          ? "Completed"
          : `${plural(result.affectedRows, "row")} affected`}{" "}
        · {result.durationMs} ms
      </p>
    </div>
  );
}

export function Outcome({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: "error" | "muted";
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Badge size="lg" variant={tone === "error" ? "error" : "secondary"}>
        {title}
      </Badge>
      <p className="max-w-prose text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}
