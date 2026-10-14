/** The letter the bird stands on, per word that can end the headline's first line. */
const FOOTHOLD: Record<string, number> = { "SQL.": 1, place: 1 };
/** Words whose tops are this close (px) share a line. */
const SAME_LINE = 4;

/** Where the bird stands: a fraction along a word's box, and its feet this far below the box's top. */
export type HeadlinePerch = { el: HTMLElement; at: number; offsetY: number };

export type Box = { left: number; top: number; right: number; bottom: number };

/** The headline in viewport px: each line's inline box, each word's ink, and the bird's perch. */
export type Headline = { lines: Box[]; ink: Box[]; perch: HeadlinePerch | null };

let measurer: CanvasRenderingContext2D | null = null;

function fontOf(el: HTMLElement): CanvasRenderingContext2D | null {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return null;
  const style = getComputedStyle(el);
  measurer.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  measurer.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  return measurer;
}

/**
 * Measures the headline. The bird lands on the last word of the first line, so it never stands in
 * front of a line above: "SQL." on one line, the l of "place" when the headline wraps. Its feet go
 * on the measured top of that letter, not on the line box; a word's ink runs from its tallest
 * letter's top to its lowest descender.
 */
export function measureHeadline(title: HTMLElement): Headline {
  const ctx = fontOf(title);
  const lines: Box[] = [];
  const ink: Box[] = [];
  let firstLineEnd: HTMLElement | null = null;
  for (const word of Array.from(title.querySelectorAll<HTMLElement>("[data-word]"))) {
    const r = word.getBoundingClientRect();
    const line = lines.find((candidate) => Math.abs(candidate.top - r.top) < SAME_LINE);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    if (lines.length === 1) firstLineEnd = word;
    const metrics = ctx?.measureText(word.textContent ?? "");
    const baseline = r.top + (metrics?.fontBoundingBoxAscent ?? 0);
    ink.push({
      left: r.left,
      right: r.right,
      top: metrics ? baseline - metrics.actualBoundingBoxAscent : r.top,
      bottom: metrics ? baseline + metrics.actualBoundingBoxDescent : r.bottom,
    });
  }
  return { lines, ink, perch: firstLineEnd ? perchOn(firstLineEnd, ctx) : null };
}

function perchOn(el: HTMLElement, ctx: CanvasRenderingContext2D | null): HeadlinePerch {
  const text = el.textContent ?? "";
  if (!ctx || !text) return { el, at: 0.5, offsetY: 0 };
  const index = FOOTHOLD[text] ?? Math.floor(text.length / 2);
  const letter = text.charAt(index);
  const width = ctx.measureText(text).width || 1;
  const glyph = ctx.measureText(letter);
  const at = (ctx.measureText(text.slice(0, index)).width + glyph.width / 2) / width;
  return { el, at, offsetY: Math.round(glyph.fontBoundingBoxAscent - glyph.actualBoundingBoxAscent) };
}

