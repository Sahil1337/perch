import { type ComponentType, lazy, Suspense, useRef } from "react";
import { cn } from "../../shared/cn";
import { useBirdFor } from "../bird/driver";
import { useFlutter } from "../bird/use-flutter";
import { Container } from "../layout/container";
import { useTryWindow } from "../sections/try/window";
import { LandingCopy } from "./copy";
import { placement as gridPlacement } from "./grid/placement";
import { placement as keysPlacement } from "./keys/placement";
import type { CopyPlacement, LandingSceneProps } from "./types";
import { SceneBoundary } from "./scene-boundary";
import { useCopyParts } from "./use-copy-parts";
import { type SceneKind, useSceneKind } from "./use-scene-kind";

// Each scene is its own chunk, so a phone never fetches the keycap sculpture and a desktop never
// fetches the grid. Only the placements, a few class names each, are in the page's bundle.
const SCENES: Record<SceneKind, { Scene: ComponentType<LandingSceneProps>; placement: CopyPlacement }> = {
  keys: { Scene: lazy(() => import("./keys/scene")), placement: keysPlacement },
  grid: { Scene: lazy(() => import("./grid/scene")), placement: gridPlacement },
};

export type LandingProps = {
  /** The scene's intro is over, skipped or scrolled past. */
  onSettled: () => void;
};

/**
 * The first view: the copy, painted at once in the place its scene wants it, and the scene for this
 * width drawn around it once its chunk arrives. Crossing the breakpoint unmounts one scene, which
 * disposes of everything it started, and mounts the other.
 */
export function Landing({ onSettled }: LandingProps) {
  const kind = useSceneKind();
  const { Scene, placement } = SCENES[kind];
  const stage = useRef<HTMLElement>(null);
  const copy = useCopyParts();
  const bird = useBirdFor("landing");
  const { target } = useTryWindow();
  const flutter = useFlutter();
  return (
    <section
      ref={stage}
      aria-labelledby="landing-title"
      className={cn("relative -mt-14 min-h-svh lg:-mt-16", placement.section)}
    >
      <SceneBoundary key={kind}>
        <Suspense fallback={null}>
          <Scene stage={stage} copy={copy} bird={bird} target={target} onSettled={onSettled} />
        </Suspense>
      </SceneBoundary>
      <Container>
        <LandingCopy parts={copy} placement={placement} onCopy={flutter} />
      </Container>
    </section>
  );
}
