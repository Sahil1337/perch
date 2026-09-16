"use client";

// What a section that is real but has no clauses of its own looks like.
//
// Two of them are left. A set-operation combine puts the branches' rows together and nothing else:
// there is no FROM, WHERE or SELECT to step through, so there is no walk to show. A section that
// WRITES — `with d as (delete from takes returning *) …` — has rows and could show them, and is
// still held here on purpose: every station the walk builds is a probe, and probing a DELETE would
// delete the rows a second time. Neither is an error and neither is loading, so neither gets a
// spinner or a red box — what they get is a sentence naming exactly what they are, because a reader
// who cannot tell "nothing to show here" from "broken" stops trusting the rest of the screen.
//
// A third used to be a `bound` section, which held the same kind of placeholder while it waited for
// a row-by-row walk that did not exist yet. It exists now: `bound-section.tsx` runs it.

import { motion } from "motion/react";
import type * as React from "react";
import { highlightSql } from "../sql-editor/highlight-sql";
import { isSetOp } from "./clauses";
import type { Section } from "./program";
import { useT } from "./walk-motion";

/** `union` and `union all` say the same thing to a reader here; the word is what matters. */
function operatorList(section: Section): string[] {
  if (section.parsed === null || !isSetOp(section.parsed)) return [];
  const seen = new Set<string>();
  for (const { op } of section.parsed.operators) seen.add(op.split(" ")[0]!.toUpperCase());
  return [...seen];
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function SectionHold({ section }: { section: Section }): React.ReactElement {
  const t = useT();
  const operators = operatorList(section);
  const branches =
    section.parsed !== null && isSetOp(section.parsed) ? section.parsed.branches.length : 0;

  if (section.unsafeToProbe) return <WritingSection section={section} />;

  return (
    <motion.section
      animate={{ opacity: 1 }}
      aria-label="Section"
      className="flex min-h-96 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-xl border border-dashed bg-muted/40 p-6 text-center"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      <h2 className="font-medium text-sm">
        Combines the branches above with{" "}
        <span className="font-mono">{joinWords(operators) || "a set operator"}</span>
      </h2>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
        {branches > 0 ? `Each of the ${branches} branches` : "Each branch"} ran on its own, in the
        chapters before this one. This step only puts their rows together, so it has no FROM, WHERE
        or SELECT of its own to step through — there is nothing here to walk yet.
        {operators.length > 1 &&
          " Note that the branches are listed as written: INTERSECT binds tighter than UNION and EXCEPT, so they do not combine left to right."}
      </p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-card p-3 text-start font-mono text-xs leading-5">
        {highlightSql(section.text)}
      </pre>
    </motion.section>
  );
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
