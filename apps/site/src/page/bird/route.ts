import type { RefObject } from "react";
import type { RoamEdge, RoamZone } from "../../shared/bird";

export type RouteStep = {
  ref: RefObject<HTMLElement | null>;
  /** 0..1 along the perch's width. */
  at: number;
  /** The share of the bird's moves in this zone that end back on this perch. */
  homing?: number;
};

// Text the bird must never stand in front of: the page's own, and the print on a piece's slips.
// Text inside a marked product window is the product's, and the bird may fly across it.
const TEXT = "h1, h2, h3, p, li, dt, dd, figcaption, [data-slip]";
const WINDOW = "[data-perch-frame]";
const PIECE = "[data-section-piece]";

/** The section a perch belongs to: its heading, its product window, the text to keep off. */
export function sectionOf(perch: HTMLElement): HTMLElement {
  return perch.closest<HTMLElement>("section, footer") ?? perch.parentElement ?? perch;
}

/**
 * The section's product window: a marked frame, or else the scene's slot, for a scene drawn without
 * the shared frame.
 */
function windowIn(section: HTMLElement): HTMLElement | null {
  const marked = section.querySelector<HTMLElement>(WINDOW);
  if (marked) return marked;
  const slot = section.querySelector<HTMLElement>("[data-section-scene]");
  if (!slot) return null;
  const r = slot.getBoundingClientRect();
  return r.width >= 240 && r.height >= 140 ? slot : null;
}

function lineRects(el: Element): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
}

/** The first line of a heading, as an edge the bird can stand on, its feet on the cap line. */
function headingEdge(heading: HTMLElement): RoamEdge | null {
  const lines = lineRects(heading).filter((r) => r.width > 4);
  const box = heading.getBoundingClientRect();
  if (!lines.length || !box.width) return null;
  const first = lines.reduce((a, b) => (b.top < a.top - 2 ? b : a));
  const row = lines.filter((r) => Math.abs(r.top - first.top) < 4);
  const left = Math.min(...row.map((r) => r.left));
  const right = Math.max(...row.map((r) => r.right));
  const style = getComputedStyle(heading);
  const size = parseFloat(style.fontSize);
  const leading = parseFloat(style.lineHeight) || size * 1.2;
  return {
    el: heading,
    from: (left - box.left) / box.width,
    to: (right - box.left) / box.width,
    offsetY: first.top - box.top + (leading - size * 0.72) / 2,
  };
}

/**
 * Where a step's bird lives: on the step's element, or, for a section's own line (a section with no
 * piece), on its heading's cap line, `at` measured along the heading's first line.
 */
function homeOf(el: HTMLElement, section: HTMLElement, at: number): RoamEdge & { at: number } {
  const heading = el.hasAttribute("data-section-perch") ? section.querySelector<HTMLElement>("h1, h2") : null;
  const edge = heading && headingEdge(heading);
  if (!edge) return { el, at, from: 0.03, to: 0.97 };
  const { from = 0, to = 1 } = edge;
  return { ...edge, at: from + (to - from) * at };
}

export function zoneFor({ el, at, homing }: Omit<RouteStep, "ref"> & { el: HTMLElement }): RoamZone {
  const section = sectionOf(el);
  const home = homeOf(el, section, at);
  const win = () => windowIn(section);
  return {
    home,
    homing,
    edges() {
      const out: RoamEdge[] = [];
      const heading = section.querySelector<HTMLElement>("h1, h2");
      const head = heading && headingEdge(heading);
      if (head && head.el !== home.el) out.push(head);
      const frame = win();
      if (frame) out.push({ el: frame, offsetY: 1 });
      return out;
    },
    *avoid() {
      const frame = section.querySelector(WINDOW);
      for (const text of section.querySelectorAll(TEXT)) {
        if (!frame?.contains(text)) yield* lineRects(text);
      }
      // A piece's print comes and goes as it loops, and a slip may unfold under a bird that landed
      // beside it, so below the perch's top edge the whole piece is kept clear, not just what shows
      // now. Above that edge is the headroom the bird stands in on its piece.
      const piece = el.closest(PIECE);
      if (piece) {
        const box = piece.getBoundingClientRect();
        yield { left: box.left, right: box.right, top: el.getBoundingClientRect().top, bottom: box.bottom };
      }
    },
    around: win,
  };
}
