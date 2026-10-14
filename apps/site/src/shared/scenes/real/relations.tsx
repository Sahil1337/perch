// The real Relationship View scene. This module is light: the window and its reserved space paint
// with the page, and the view itself — @perch/ui and the recorded schema — loads once the scene
// comes within a screen of the viewport.

import * as React from "react";
import { usePrefersReducedMotion } from "../../motion/use-in-view";
import type { SceneProps } from "../types";
import { SceneWindow, useNear, useVisible } from "./relations-walk-kit";

const RelationsSceneInner = React.lazy(() => import("./relations-scene"));

/**
 * The app's viewport for this scene. A small laptop's window rather than a desktop's, like every
 * stage scene: the stage fits a window to the view's height, and at this size the app reads at about
 * 0.8 scale on a laptop.
 */
const WIDTH = 1040;
const HEIGHT = 720;

export const RelationsScene: React.FC<SceneProps> = ({ className, autoplay = true, paused = false, onReady, onDone }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  // Held back by the page reads as offscreen to the scene: it waits where it is.
  const visible = useVisible(ref, 0.4) && !paused;
  const reduced = usePrefersReducedMotion();

  return (
    <div className={className} ref={ref}>
      <SceneWindow
        height={HEIGHT}
        held={!visible}
        label="Perch's Relationship View: the birdwatch schema's tables and the keys between them"
        width={WIDTH}
      >
        {(parts) =>
          near && (
            <React.Suspense fallback={null}>
              <RelationsSceneInner
                autoplay={autoplay}
                onDone={onDone}
                onReady={onReady}
                parts={parts}
                reduced={reduced}
                visible={visible}
              />
            </React.Suspense>
          )
        }
      </SceneWindow>
    </div>
  );
};
