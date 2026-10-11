import type { RefObject } from "react";
import type { BirdFacing, RoamEdge, RoamZone } from "../../shared/bird";

export type RouteStep = {
  ref: RefObject<HTMLElement | null>;
  /** 0..1 along the perch's width. */
  at: number;
  facing?: BirdFacing;
  offsetY?: number;
  /** The share of the bird's moves in this zone that end back on this perch. */
  homing?: number;
};

// Text the bird must never stand in front of. Text inside a marked product window is the product's,
// and the bird may fly across it.
const TEXT = "h1, h2, h3, p, li, dt, dd, figcaption";
const WINDOW = "[data-perch-frame]";

/** The section a perch belongs to: its heading, its product window, the text to keep off. */
export function sectionOf(perch: HTMLElement): HTMLElement {
  return perch.closest<HTMLElement>("section, footer") ?? perch.parentElement ?? perch;
}

/**
 * The section's product window: a marked frame, or else the scene's own slot, the block after the
 * heading under the perch, for a scene drawn without the shared frame.
 */
function windowIn(section: HTMLElement, perch: HTMLElement): HTMLElement | null {
  const marked = section.querySelector<HTMLElement>(WINDOW);
  if (marked) return marked;
  const slot = perch.parentElement?.lastElementChild;
  if (!(slot instanceof HTMLElement) || slot === perch || slot.querySelector("h1, h2")) return null;
  const r = slot.getBoundingClientRect();
  return r.width >= 240 && r.height >= 140 ? slot : null;
}

/** The first line of a heading, as an edge the bird can stand on, its feet on the cap line. */
function headingEdge(heading: HTMLElement): RoamEdge | null {
  const range = document.createRange();
  range.selectNodeContents(heading);
  const lines = [...range.getClientRects()].filter((r) => r.width > 4);
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

/** The section's top hairline, held to the content's width, for a section with no perch of its own. */
function branchEdge(section: HTMLElement): RoamEdge | null {
  const branch = section.querySelector<HTMLElement>(":scope > [aria-hidden]");
  const content = section.querySelector<HTMLElement>(":scope > :not([aria-hidden])");
  if (!branch || !content) return null;
  const r = branch.getBoundingClientRect();
  const c = content.getBoundingClientRect();
  if (r.height > 4 || !r.width) return null;
  const pad = parseFloat(getComputedStyle(content).paddingLeft) || 0;
  return { el: branch, from: (c.left + pad - r.left) / r.width, to: (c.right - pad - r.left) / r.width };
}

function lineRects(el: Element): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
}

export function zoneFor({ el, at, facing, offsetY, homing }: Omit<RouteStep, "ref"> & { el: HTMLElement }): RoamZone {
  const section = sectionOf(el);
  const win = () => windowIn(section, el);
  return {
    home: { el, at, facing, offsetY, from: 0.03, to: 0.97 },
    homing,
    edges() {
      const out: RoamEdge[] = [];
      const heading = section.querySelector<HTMLElement>("h1, h2");
      const head = heading && headingEdge(heading);
      if (head) out.push(head);
      const frame = win();
      if (frame) out.push({ el: frame, offsetY: 1 });
      // a perch that is not the section's own branch line (the install command) leaves the branch free
      const branch = el.matches("[aria-hidden]") ? null : branchEdge(section);
      if (branch) out.push(branch);
      return out;
    },
    *avoid() {
      const frame = section.querySelector(WINDOW);
      for (const text of section.querySelectorAll(TEXT)) {
        if (!frame?.contains(text)) yield* lineRects(text);
      }
    },
    around: win,
  };
}
