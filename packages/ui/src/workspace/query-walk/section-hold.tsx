"use client";

// What a section that is real but has no clauses of its own looks like.
//
// One of them is left. A set-operation combine puts the branches' rows together and nothing else:
// there is no FROM, WHERE or SELECT to step through, so there is no walk to show. That is not an
// error and it is not loading, so it gets no spinner and no red box — what it gets is a sentence
// naming exactly what it is, because a reader who cannot tell "nothing to show here" from "broken"
// stops trusting the rest of the screen.
//
// The other used to be a `bound` section, which held the same kind of placeholder while it waited
// for a row-by-row walk that did not exist yet. It exists now: `bound-section.tsx` runs it.

import { motion } from "motion/react";
import type * as React from "react";
import { highlightSql } from "../sql-editor/highlight-sql";
import { isSetOp } from "./clauses";
import type { Section } from "./program";
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

export function SectionHold({ section }: { section: Section }): React.ReactElement {
  const t = useT();
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
        {highlightSql(section.parsed.text)}
      </pre>
    </motion.section>
  );
}
