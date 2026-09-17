"use client";

// What a section that is real but has no clauses of its own looks like.
//
// One of them is left. A section that WRITES — `with d as (delete from takes returning *) …` — has
// rows and could show them, and is held here on purpose: every station the walk builds is a probe,
// and probing a DELETE would delete the rows a second time. It is not an error and it is not
// loading, so it gets neither a spinner nor a red box — what it gets is a sentence naming exactly
// what it is, because a reader who cannot tell "nothing to show here" from "broken" stops trusting
// the rest of the screen.
//
// Two others used to live here. A `bound` section held this kind of placeholder while it waited for
// a row-by-row walk that did not exist yet; `bound-section.tsx` runs it now. A set-operation combine
// held one too, on the reasoning that putting two results together has no clauses to step through —
// true, and beside the point: `buildSetStations` asks the database which rows survived and from
// which side, so the combine is a station walk like any other and never reaches this file.

import { motion } from "motion/react";
import type * as React from "react";
import { highlightSql } from "../sql-editor/highlight-sql";
import type { Section } from "./program";
import { useT } from "./walk-motion";

export function SectionHold({ section }: { section: Section }): React.ReactElement {
  return <WritingSection section={section} />;
}

/**
 * A section that would change the database: shown, never run.
 *
 * These are the chapters that hold on purpose rather than for want of something to say. The rows a
 * `RETURNING` hands back are a real step of the query and belong on the strip — but every station
 * the walk builds is a probe, and a probe of a DELETE deletes.
 *
 * Two different chapters arrive here and the difference matters to the reader. One IS the write.
 * The others merely sit downstream of it, and are held for a subtler reason: a probe carries its
 * section's whole WITH prefix, so the final query's ten stations would each splice that same DELETE
 * back in and run it again. Saying only "this deletes" on a chapter that plainly selects would read
 * as a mistake, and the reader would go looking for the DELETE that is not there.
 */
function WritingSection({ section }: { section: Section }): React.ReactElement {
  const t = useT();
  const own = section.result?.kind === "writes";
  const verb = (section.result?.verb ?? "write").toUpperCase();
  if (!own) return <DownstreamOfWrite section={section} />;
  return (
    <motion.section
      animate={{ opacity: 1 }}
      aria-label="Section"
      className="flex min-h-96 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-xl border border-dashed bg-muted/40 p-6 text-center"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      <h2 className="font-medium text-sm">
        This step <span className="font-mono">{verb}</span>s — it is shown, not run
      </h2>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
        A data-modifying statement inside <span className="font-mono">WITH</span> is a real step of
        this query, and its rows are read by the chapters after it — so it belongs on the strip. But
        every station of this walk asks the database a question of its own, and asking a{" "}
        <span className="font-mono">{verb}</span> would change your data a second time. Nothing was
        sent for this chapter. Run the query itself when you want it to happen.
      </p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-card p-3 text-start font-mono text-xs leading-5">
        {highlightSql(section.result?.body ?? section.text)}
      </pre>
    </motion.section>
  );
}

/** A chapter held because something it READS writes. See `WritingSection` for why that is fatal. */
function DownstreamOfWrite({ section }: { section: Section }): React.ReactElement {
  const t = useT();
  return (
    <motion.section
      animate={{ opacity: 1 }}
      aria-label="Section"
      className="flex min-h-96 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-xl border border-dashed bg-muted/40 p-6 text-center"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      <h2 className="font-medium text-sm">Nothing here was run</h2>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
        This step only reads, but one of the <span className="font-mono">WITH</span> steps above it
        changes the database — and every question this walk asks carries that whole{" "}
        <span className="font-mono">WITH</span> along with it. Stepping through the clauses here
        would re-run the write once for each station, so the walk stops rather than touch your data.
        Run the query yourself to see this result.
      </p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-card p-3 text-start font-mono text-xs leading-5">
        {highlightSql(section.text)}
      </pre>
    </motion.section>
  );
}
