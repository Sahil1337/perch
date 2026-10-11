// Types for bird.js, from the JSDoc at the top of that file.

export type BirdLook = "porcelain" | "line";
export type BirdFacing = "left" | "right" | "auto";

/** Colours three.js can read: hex, rgb() or hsl(). BirdProvider converts any CSS colour first. */
export type PorcelainPalette = { body?: string; wing?: string; beak?: string; eye?: string };
/** `fill` is the page background behind the bird; `strokeWidth` is in CSS px. */
export type LinePalette = { fill?: string; stroke?: string; strokeWidth?: number };
export type BirdPalette = PorcelainPalette | LinePalette;

/**
 * A point a flight passes through. With `el`, x and y are px from that element's top-left corner,
 * so the path moves with it as the page scrolls; without, they are viewport px.
 */
export type ViaPoint = { el?: Element; x: number; y: number };

export type PerchOptions = {
  /** 0..1 along the element's top edge. Default 0.8. */
  at?: number;
  /** Default "auto": towards the middle of the page. */
  facing?: BirdFacing;
  /** Lowers the branch, for rounded corners or borders. */
  offsetY?: number;
  /** Points to fly through on the way, for a loop or a lap; the path runs smoothly through them. */
  via?: ViaPoint[];
  /** Speed of the flight; below 1 is lazier. Default 1. */
  pace?: number;
};

export type GuideStep = PerchOptions & {
  el: Element;
  /** 0..1, default 0.3: how much of the viewport, centred, counts as this step's band. */
  band?: number;
};

export type BirdOptions = {
  look?: BirdLook;
  palette?: BirdPalette;
  /** Length tail to beak, CSS px. Default 64. */
  size?: number;
  followPointer?: boolean;
  reducedMotion?: "auto" | boolean;
  /** Where the overlay is appended. Default document.body. */
  container?: HTMLElement;
  /** Default 1000. */
  zIndex?: number;
  debug?: boolean;
  seed?: number;
};

export type BirdPerch = { el: Element; at: number; facing: BirdFacing };

export interface Bird {
  /** "svg" when WebGL is unavailable: the 2D mark, moved by crossfading, same API. */
  readonly renderer: "webgl" | "svg";
  /** The current perch, or the destination while flying; null before the first perch. */
  readonly perch: BirdPerch | null;
  /** Where the feet are, in viewport px; null before the bird has appeared. */
  readonly position: { x: number; y: number } | null;
  /** Taking off or in the air. */
  readonly flying: boolean;
  /** Whether it is keeping still: reduced motion requested, by the page or the system. */
  readonly reducedMotion: boolean;
  /** Length tail to beak, CSS px. */
  readonly size: number;
  /** Flights stay below this element's bottom edge, a sticky nav for one; null lifts the limit. */
  setCeiling(el: Element | null): void;
  /** Fly to el's top edge and land; resolves on landing. Mid-flight it bends the path. */
  perchOn(el: Element, options?: PerchOptions): Promise<void>;
  /** Place on a perch without flying, with a short fade-in. */
  appear(el: Element, options?: PerchOptions): Promise<void>;
  /** Enter from off-screen and land, for a page-load moment. */
  flyIn(el: Element, options?: PerchOptions): Promise<void>;
  /** As the page scrolls, fly at once to the step nearest the viewport's centre band. Returns stop(). */
  guide(steps: GuideStep[] | null): () => void;
  /** Turn the head toward a viewport point for a moment. */
  lookAt(point: { x: number; y: number }): void;
  followPointer(on: boolean): void;
  hop(): void;
  flutter(): void;
  setLook(look: BirdLook, palette?: BirdPalette): void;
  setSize(px: number): void;
  setReducedMotion(value: "auto" | boolean): void;
  on(name: "land", listener: (el: Element | null) => void): () => void;
  on(name: "takeoff", listener: (from: Element | null, to: Element | null) => void): () => void;
  destroy(): void;
}

export function createBird(options?: BirdOptions): Promise<Bird>;
