import * as React from "react";
import type { SceneProps } from "../../scenes/types";
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

type Loader = () => Promise<{ default: React.ComponentType<RealSceneProps> }>;

/**
 * A real scene as the light export prototypes import. The frame — chrome, aspect ratio, scale — is
 * here and paints at once; CodeMirror and the workspace are in `load`'s module, fetched only once
 * the frame comes within a viewport's height of being seen, and rendered into the frame's app area.
 * The frame's elements never change, so an anchor taken from them stays good.
 */
export function lazyScene(load: Loader, size: FrameSize): React.FC<SceneProps> {
  const Real = React.lazy(load);

  function Scene(props: SceneProps): React.ReactElement {
    const [parts, setParts] = React.useState<FrameParts | null>(null);
    const [near, setNear] = React.useState(false);
    const [handed, setHanded] = React.useState(false);
    const handOver = React.useCallback(() => setHanded(true), []);
    const live = props.usable === true && handed;

    React.useEffect(() => {
      if (!parts || near) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) setNear(true);
        },
        { rootMargin: "100% 0px" },
      );
      observer.observe(parts.outer);
      return () => observer.disconnect();
    }, [parts, near]);

    return (
      <WindowFrame className={props.className} live={live} onParts={setParts} size={size}>
        {parts && near ? (
          <Quiet>
            <React.Suspense fallback={null}>
              <Real {...props} handOver={handOver} live={live} parts={parts} size={size} />
            </React.Suspense>
          </Quiet>
        ) : null}
      </WindowFrame>
    );
  }
  return Scene;
}

/** A scene that fails to load leaves its empty window rather than taking the page down with it. */
class Quiet extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
