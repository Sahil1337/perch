// The stage a chapter shows when it is real but was deliberately not run.
//
// Three of them exist — a write, a chapter downstream of a write, and a correlated section with
// nothing to bind it to — and they must not look like an error or like loading, because a reader
// who cannot tell "nothing to show here" from "broken" stops trusting the rest of the screen. What
// they get instead is a heading, a sentence naming exactly what happened, and the SQL itself.

import { motion } from "motion/react";
import type * as React from "react";
import { highlightSql } from "../sql-editor/highlight-sql";
import { useT } from "./walk-motion";

export function HeldSection({
  title,
  children,
  sql,
}: {
  readonly title: React.ReactNode;
  /** The paragraph under the heading, which every one of these writes differently. */
  readonly children: React.ReactNode;
  readonly sql: string;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.section
      animate={{ opacity: 1 }}
      aria-label="Section"
      className="flex min-h-96 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-xl border border-dashed bg-muted/40 p-6 text-center"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      <h2 className="font-medium text-sm">{title}</h2>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">{children}</p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-card p-3 text-start font-mono text-xs leading-5">
        {highlightSql(sql)}
      </pre>
    </motion.section>
  );
}
