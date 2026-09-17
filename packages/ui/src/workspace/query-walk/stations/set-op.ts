// One station per meeting of two results in a set-operator chain.

import { regroups, type ParsedSetOp, type SetTree } from "../clauses";
import { combineSentence } from "../narration/combine-sentence";
import { station, wrap, type Query, type Station } from "../station-types";

/**
 * One station per meeting of two results in a set-operator chain.
 *
 * WHY THIS IS NOT A PLACEHOLDER ANY MORE. A combine has no clauses, so the station rail's usual
 * vocabulary says nothing about it — but "which rows survived, and from which side" is a question
 * with an exact answer, and the database can be asked it directly. What made it look unanswerable
 * was that the obvious way to answer it is wrong: the branches' own cards hold 25 sampled rows
 * each, and deciding membership by comparing those two samples would report a row as dropped by an
 * INTERSECT whenever its partner happened to fall outside the other sample. That is a confident
 * lie of exactly the kind this screen exists not to tell. So nothing is compared here. Every
 * bucket below is a set operation the DATABASE evaluates over the full branches.
 *
 * THE THREE BUCKETS. `L INTERSECT R`, `L EXCEPT R` and `R EXCEPT L` partition the distinct rows of
 * the two sides, and between them they explain every operator: UNION keeps all three, INTERSECT
 * keeps the middle one, EXCEPT keeps the first. The picture is a Venn diagram whose regions were
 * each computed rather than inferred, and the only words the walk writes are the operator names.
 *
 * WHY `ALL` GETS NO BUCKETS. The partition is about DISTINCT rows. `UNION ALL` keeps duplicates, so
 * its answer can be longer than the three buckets put together, and drawing them beside it would
 * misdescribe the very thing that makes `ALL` different. Those stations show the two inputs and the
 * real result, and say why the regions are missing.
 *
 * Each subtree is a CONTIGUOUS run of branches, and its verbatim text re-parses to the same
 * grouping, because that grouping came from precedence in the first place — which is what lets a
 * node's SQL be a slice of the user's statement rather than something reassembled.
 */
export function buildSetStations(parsed: ParsedSetOp): Station[] {
  const withPrefix = parsed.with ? `${parsed.text.slice(parsed.with.from, parsed.with.to)}\n` : "";
  // The branches a subtree spans. Contiguity is the invariant the slice below depends on.
  const span = (node: SetTree): { min: number; max: number } => {
    if (node.kind === "branch") return { min: node.index, max: node.index };
    const left = span(node.left);
    const right = span(node.right);
    return { min: Math.min(left.min, right.min), max: Math.max(left.max, right.max) };
  };
  const sqlOf = (node: SetTree): string => {
    const { min, max } = span(node);
    const from = parsed.branches[min]!.range.from;
    const to = parsed.branches[max]!.range.to;
    return parsed.text.slice(from, to);
  };
  /** A subtree as an operand: parenthesised, so a branch's own ORDER BY or LIMIT stays inside it. */
  const operand = (node: SetTree): string => `(\n${sqlOf(node)}\n)`;
  const { limited, counted } = wrap(withPrefix);
  const pair = (id: string, label: string, sql: string): Query[] => [
    { id: `${id}.sample`, label, sql: limited(sql) },
    { id: `${id}.count`, label: `${label} — count`, sql: counted(sql) },
  ];

  const nodes: Extract<SetTree, { kind: "combine" }>[] = [];
  // Post-order, so the chapter plays in the order the database evaluates: the tightest-binding
  // meeting first, and each later station's inputs are ones the reader has already been shown.
  const collect = (node: SetTree): void => {
    if (node.kind === "branch") return;
    collect(node.left);
    collect(node.right);
    nodes.push(node);
  };
  collect(parsed.tree);

  const repeated = new Set<string>();
  const seen = new Set<string>();
  for (const node of nodes) {
    const word = node.op.toUpperCase();
    if (seen.has(word)) repeated.add(word);
    seen.add(word);
  }
  const ordinal = new Map<string, number>();

  return nodes.map((node) => {
    const word = node.op.toUpperCase();
    const next = (ordinal.get(word) ?? 0) + 1;
    ordinal.set(word, next);
    const left = operand(node.left);
    const right = operand(node.right);
    const result = `${left}\n${node.op}\n${right}`;
    const keepsDuplicates = node.op.endsWith(" all");

    // Two batches on purpose. The first is the chapter: the inputs and the answer, and it must not
    // be lost to a dialect that cannot evaluate the second. The second is the Venn regions, which
    // need INTERSECT and EXCEPT — MySQL only learned them in 8.0.31 — so when they fail they fail
    // alone and the scene says the regions are unavailable rather than showing them empty.
    const batches: Query[][] = [
      [
        ...pair("left", "The left-hand result", sqlOf(node.left)),
        ...pair("right", "The right-hand result", sqlOf(node.right)),
        { id: "sample", label: `After ${word}`, sql: limited(result) },
        { id: "count", label: "Count", sql: counted(result) },
      ],
    ];
    if (!keepsDuplicates) {
      // One region of every INTERSECT and EXCEPT is the operator's own answer — `L intersect R` IS
      // the middle region, `L except R` IS the left one — so asking for it again would send the
      // same statement to the user's database twice per station. The region is dropped here and
      // the scene reads it off `sample`, which also means it survives a dialect that cannot
      // evaluate the rest of this batch.
      const same = node.op.startsWith("intersect")
        ? "both"
        : node.op.startsWith("except")
          ? "onlyLeft"
          : null;
      batches.push([
        ...(same === "both" ? [] : pair("both", "In both", `${left}\nintersect\n${right}`)),
        ...(same === "onlyLeft"
          ? []
          : pair("onlyLeft", "Only on the left", `${left}\nexcept\n${right}`)),
        ...pair("onlyRight", "Only on the right", `${right}\nexcept\n${left}`),
      ]);
    }

    return station({
      key: `combine${node.opIndex}`,
      id: "combine",
      label: repeated.has(word) ? `${word} ${next}` : word,
      present: true,
      clause: parsed.operators[node.opIndex]?.range ?? null,
      batches,
      // A chain that regroups owes the reader one more sentence, and only on the station that DOES
      // the regrouping: these two results met first because this operator binds tighter, not
      // because they were written next to each other.
      sentence: combineSentence(
        node.op,
        keepsDuplicates,
        regroups(parsed) && node.op.startsWith("intersect"),
      ),
    });
  });
}
