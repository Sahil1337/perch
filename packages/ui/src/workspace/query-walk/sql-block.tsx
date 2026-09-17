"use client";

// A statement shown as reference rather than as a gesture: highlighted, wrapped, and still.
//
// `SqlParts` is the other half of this — the same block with its substitutions cross-fading. This
// one is for the statements nothing is being spliced into, which is most of them.

import type * as React from "react";
import { highlightSql } from "../sql-editor/highlight-sql";

export function SqlBlock({ sql }: { readonly sql: string }): React.ReactElement {
  return (
    <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-sm leading-5">
      {highlightSql(sql)}
    </pre>
  );
}
