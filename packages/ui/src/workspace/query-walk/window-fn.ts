// The window functions in a select list, read off the item's own words.

import { bareName, type ParsedSelect, type Range } from "./clauses";
import { at, pieces, splitCommas, type Piece } from "./item-pieces";

export type WindowFn = {
  /** The whole expression as written, `over` and its spec included. */
  readonly expr: string;
  /** Just the call: `rank()`, `avg(salary)`. */
  readonly call: string;
  /** The PARTITION BY expressions, as written. Empty when the whole result is one pane. */
  readonly partition: readonly string[];
  /** The frame's ORDER BY items, as written, `desc` and all. */
  readonly order: readonly string[];
  /** The named window it was written against, when it used one. */
  readonly named: string | null;
};

/** Words that end the expression list before them inside an OVER spec. */
const SPEC_WORDS = new Set(["partition", "order", "rows", "range", "groups", "exclude"]);

/** The expressions between `start` and the next word that ends them. */
function specList(
  spec: string,
  list: readonly Piece[],
  start: number,
): { items: string[]; next: number } {
  let i = start;
  while (i < list.length && !(list[i]!.word !== null && SPEC_WORDS.has(list[i]!.word!))) i += 1;
  return { items: splitCommas(spec, list.slice(start, i)), next: i };
}

/**
 * The partition and frame order an OVER spec asks for. A spec may open with the name of another
 * window (`over (w order by hired)`), which inherits that window's partition and only overrides
 * what it spells out; `seen` is what stops a window defined in terms of itself from looping.
 */
function readSpec(
  spec: string,
  named: ReadonlyMap<string, string>,
  seen: ReadonlySet<string>,
): { partition: readonly string[]; order: readonly string[] } {
  const list = pieces(spec);
  let partition: readonly string[] = [];
  let order: readonly string[] = [];
  let i = 0;
  const head = at(list, 0);
  if (head !== null && !SPEC_WORDS.has(head) && named.has(head) && !seen.has(head)) {
    const base = readSpec(named.get(head)!, named, new Set([...seen, head]));
    partition = base.partition;
    order = base.order;
    i = 1;
  }
  while (i < list.length) {
    if (at(list, i) === "partition" && at(list, i + 1) === "by") {
      const read = specList(spec, list, i + 2);
      partition = read.items;
      i = read.next;
    } else if (at(list, i) === "order" && at(list, i + 1) === "by") {
      const read = specList(spec, list, i + 2);
      order = read.items;
      i = read.next;
    } else i += 1;
  }
  return { partition, order };
}

/** `WINDOW w AS (…), v AS (…)` by name, so `over w` can be resolved to what it stands for. */
function namedWindows(parsed: ParsedSelect): Map<string, string> {
  const out = new Map<string, string>();
  if (!parsed.window) return out;
  const body = parsed.text.slice(parsed.window.body.from, parsed.window.body.to);
  for (const definition of splitCommas(body, pieces(body))) {
    const list = pieces(definition);
    const spec = list[2];
    if (!list[0] || at(list, 1) !== "as" || !spec?.text.startsWith("(")) continue;
    out.set(bareName(list[0].text).toLowerCase(), spec.text.slice(1, -1));
  }
  return out;
}

/** Every window function in the select list, in the order it was written. */
export function windowFunctions(parsed: ParsedSelect): WindowFn[] {
  const named = namedWindows(parsed);
  const out: WindowFn[] = [];
  for (const item of parsed.selectItems) {
    const list = pieces(item);
    const over = list.findIndex((piece) => piece.word === "over");
    const spec = list[over + 1];
    // `over` as the first piece is not a call being windowed, it is a column someone named `over`.
    if (over < 1 || !spec) continue;
    const inline = spec.text.startsWith("(");
    const name = inline ? null : bareName(spec.text).toLowerCase();
    const body = inline ? spec.text.slice(1, -1) : (named.get(name!) ?? null);
    if (body === null) continue;
    out.push({
      expr: item.slice(list[0]!.from, spec.to),
      call: item.slice(list[0]!.from, list[over - 1]!.to),
      named: name,
      ...readSpec(body, named, new Set(name === null ? [] : [name])),
    });
  }
  return out;
}

/**
 * Where the narrator points for a window function: at the WINDOW clause when the function was
 * written against a named window, because that is where the partition is spelled, and otherwise at
 * the expression itself, found by the text it was sliced from.
 */
export function windowRange(parsed: ParsedSelect, fn: WindowFn): Range | null {
  if (fn.named !== null && parsed.window) return parsed.window.range;
  const found = parsed.text.indexOf(fn.expr, parsed.selectList.from);
  return found < 0 || found >= parsed.selectList.to
    ? parsed.selectList
    : { from: found, to: found + fn.expr.length };
}
