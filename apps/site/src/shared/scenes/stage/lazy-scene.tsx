import * as React from "react";
import { SceneBoundary } from "../scene-boundary";
import { useNear } from "../../viewport/visibility";
import type { SceneProps } from "../types";
import { type FrameParts, type FrameSize, WindowFrame } from "./window-frame";

/**
 * What a real scene's heavy module receives: the scene's props, the frame it renders into, and for
 * a `usable` scene the hand-over: `handOver` gives the visitor the app, after which `live` is true.
 */
export type RealSceneProps = SceneProps & {
  parts: FrameParts;
  size: FrameSize;
  live: boolean;
  handOver: () => void;
};

// How far ahead of the view, in view heights, a scene's app mounts: far enough that the first
// feature's window, below its section's piece, mounts with the page on a phone rather than in the
// same first scroll as the try window's app.
const MOUNT_AHEAD = 1.5;

type Loader = () => Promise<{ default: React.ComponentType<RealSceneProps> }>;

/**
 * A real scene as the light export prototypes import. The frame — chrome, aspect ratio, scale — is
 * here and paints at once; CodeMirror and the workspace are in `load`'s module, fetched only once
 * the frame comes within a viewport and a half of being seen, and rendered into the frame's app area.
 * The frame's elements never change, so an anchor taken from them stays good.
 */
export function lazyScene(load: Loader, size: FrameSize): React.FC<SceneProps> {
  const Real = React.lazy(load);

  function Scene(props: SceneProps): React.ReactElement {
    const [parts, setParts] = React.useState<FrameParts | null>(null);
    const [handed, setHanded] = React.useState(false);
    const handOver = React.useCallback(() => setHanded(true), []);
    const live = props.usable === true && handed;

    const near = useNear(parts?.outer ?? null, MOUNT_AHEAD);

    return (
      <WindowFrame className={props.className} live={live} onParts={setParts} size={size}>
        {parts && near ? (
          // A scene that fails to load leaves its empty window rather than taking the page down with it.
          <SceneBoundary>
            <React.Suspense fallback={null}>
              <Real {...props} handOver={handOver} live={live} parts={parts} size={size} />
            </React.Suspense>
          </SceneBoundary>
        ) : null}
      </WindowFrame>
    );
  }
  return Scene;
}
