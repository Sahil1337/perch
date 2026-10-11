// The real Relationship View scene. This module is light: the window and its reserved space paint
// with the page, and the view itself — @perch/ui and the recorded schema — loads once the scene
// comes within a screen of the viewport.

import * as React from "react";
import { usePrefersReducedMotion } from "../../motion/use-in-view";
import type { SceneProps } from "../types";
import { SceneWindow, useNear, useVisible } from "./relations-walk-kit";

const RelationsSceneInner = React.lazy(() => import("./relations-scene"));

/** The app's viewport for this scene, the size the legacy one was captured at. */
const WIDTH = 1280;
const HEIGHT = 840;

export const RelationsScene: React.FC<SceneProps> = ({ className, autoplay = true, onReady, onDone }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const visible = useVisible(ref, 0.4);
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
