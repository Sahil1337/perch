import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Bird, BirdLook, BirdPalette } from "./bird";
import { resolvePalette } from "./colors";

export type BirdSize = number | { base: number; md?: number; lg?: number };

export type BirdProviderProps = {
  look?: BirdLook;
  /** Any CSS colours, theme tokens included (`var(--foreground)`); converted for three.js. */
  palette?: BirdPalette;
  /** Length tail to beak in CSS px, or per breakpoint (md 48rem, lg 64rem). */
  size?: BirdSize;
  /** Now and then turn the head toward the pointer. Default true. */
  followPointer?: boolean;
  /** The overlay's z-index. Default 40: over the page, under a z-50 sticky nav. */
  zIndex?: number;
  children: ReactNode;
};

const BirdContext = createContext<Bird | null>(null);

const DEFAULT_SIZE = { base: 40, md: 48, lg: 56 };
const MD = "(min-width: 48rem)";
const LG = "(min-width: 64rem)";

function sizeFor(size: BirdSize): number {
  if (typeof size === "number") return size;
  if (size.lg !== undefined && matchMedia(LG).matches) return size.lg;
  if (size.md !== undefined && matchMedia(MD).matches) return size.md;
  return size.base;
}

// After the first paint and, where the browser offers it, an idle moment: nothing on the page
// waits for the bird.
function afterFirstPaint(run: () => void): () => void {
  let idle = 0;
  let timer = 0;
  const frame = requestAnimationFrame(() => {
    timer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) idle = requestIdleCallback(run, { timeout: 600 });
      else run();
    }, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    if (idle) cancelIdleCallback(idle);
  };
}

/**
 * Creates the bird once the page has painted, and destroys it on unmount. The bird is optional by
 * construction: if three.js, WebGL and the SVG fallback all fail, useBird() stays null and the page
 * stands without it.
 */
export function BirdProvider({
  look = "porcelain",
  palette,
  size = DEFAULT_SIZE,
  followPointer = true,
  zIndex = 40,
  children,
}: BirdProviderProps) {
  const [bird, setBird] = useState<Bird | null>(null);
  const paletteKey = JSON.stringify(palette ?? null);
  const sizeKey = JSON.stringify(size);

  useEffect(() => {
    let live = true;
    let made: Bird | null = null;
    const cancel = afterFirstPaint(() => {
      import("./bird.js")
        .then(({ createBird }) =>
          createBird({
            look,
            palette: resolvePalette(JSON.parse(paletteKey) as BirdPalette | undefined),
            size: sizeFor(JSON.parse(sizeKey) as BirdSize),
            followPointer,
            zIndex,
          }),
        )
        .then((created) => {
          if (!live) return created.destroy();
          made = created;
          setBird(created);
        })
        .catch((error: unknown) => console.warn("The bird could not start; the page goes on without it.", error));
    });
    return () => {
      live = false;
      cancel();
      made?.destroy();
      setBird(null);
    };
    // Created once; look, palette and size reach the live bird through the effects below.
  }, [zIndex]);

  useEffect(() => {
    if (!bird) return;
    try {
      bird.setLook(look, resolvePalette(JSON.parse(paletteKey) as BirdPalette | undefined));
    } catch {
      // a palette the bird cannot read leaves it as it was
    }
  }, [bird, look, paletteKey]);

  useEffect(() => {
    bird?.followPointer(followPointer);
  }, [bird, followPointer]);

  useEffect(() => {
    if (!bird) return;
    const parsed = JSON.parse(sizeKey) as BirdSize;
    const apply = () => bird.setSize(sizeFor(parsed));
    apply();
    if (typeof parsed === "number") return;
    const queries = [matchMedia(MD), matchMedia(LG)];
    for (const query of queries) query.addEventListener("change", apply);
    return () => {
      for (const query of queries) query.removeEventListener("change", apply);
    };
  }, [bird, sizeKey]);

  return <BirdContext.Provider value={bird}>{children}</BirdContext.Provider>;
}

/** The live bird, or null until it has loaded (after first paint) or when it could not. */
export function useBird(): Bird | null {
  return useContext(BirdContext);
}
