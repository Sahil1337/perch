"use client";

// What a section that is real but deliberately not running looks like.
//
// Two of them exist. A `bound` section re-runs for every row of another section, so it has no single
// result: running it once here would put a number on screen that is true of no row. A set-operation
// combine has no clauses of its own to step through at all. Neither is an error and neither is
// loading, so neither gets a spinner or a red box — what they get is a sentence naming exactly what
// they are waiting on, because a reader who cannot tell "not yet" from "broken" stops trusting the
// rest of the screen.

import { motion } from "motion/react";
import * as React from "react";
import { Button } from "../../ui/button";
import { highlightSql } from "../sql-editor/highlight-sql";
import { isSetOp } from "./clauses";
import { sectionById, type Program, type Section, type SectionId } from "./program";
import { useT } from "./walk-motion";

/** `union` and `union all` say the same thing to a reader here; the word is what matters. */
function operatorList(section: Section): string[] {
  if (!isSetOp(section.parsed)) return [];
  const seen = new Set<string>();
  for (const { op } of section.parsed.operators) seen.add(op.split(" ")[0]!.toUpperCase());
  return [...seen];
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function SectionHold({
  program,
  section,
  onOpenSection,
}: {
  program: Program;
  section: Section;
  onOpenSection: (id: SectionId) => void;
}): React.ReactElement {
  const t = useT();
  const { binding } = section;
  const outer = binding.kind === "bound" ? sectionById(program, binding.outer) : null;
  const operators = operatorList(section);
  const branches = isSetOp(section.parsed) ? section.parsed.branches.length : 0;

  return (
    <motion.section
      animate={{ opacity: 1 }}
      aria-label="Section"
      className="flex min-h-96 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-xl border border-dashed bg-muted/40 p-6 text-center"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      {binding.kind === "bound" ? (
        <>
          <h2 className="flex flex-wrap items-center justify-center gap-1.5 font-medium text-sm">
            Runs once for each row of
            {outer ? (
              <Button onClick={() => onOpenSection(outer.id)} size="xs" variant="outline">
                {outer.label}
              </Button>
            ) : (
              <span className="font-mono">the query above it</span>
            )}
          </h2>
          <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
            It is correlated on{" "}
            {binding.columns.map((column, i) => (
              <React.Fragment key={column}>
                {i > 0 && ", "}
                <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground text-xs">
                  {column}
                </code>
              </React.Fragment>
            ))}
            {binding.columns.length === 0 && "the row it sits inside"}, so it has no one answer to
            show: each of those values arrives from the outer row and changes the rows that come
            back. Running it once here would print a result that is true of no row, so nothing has
            been run. The row-by-row walk is what this section is waiting for.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-medium text-sm">
            Combines the branches above with{" "}
            <span className="font-mono">{joinWords(operators) || "a set operator"}</span>
          </h2>
          <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">
            {branches > 0 ? `Each of the ${branches} branches` : "Each branch"} ran on its own, in
            the chapters before this one. This step only puts their rows together, so it has no
            FROM, WHERE or SELECT of its own to step through — there is nothing here to walk yet.
            {operators.length > 1 &&
              " Note that the branches are listed as written: INTERSECT binds tighter than UNION and EXCEPT, so they do not combine left to right."}
          </p>
        </>
      )}
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-card p-3 text-start font-mono text-xs leading-5">
        {highlightSql(section.parsed.text)}
      </pre>
    </motion.section>
  );
}
