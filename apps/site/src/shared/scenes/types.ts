export type SceneAnchors = { window: HTMLElement; titlebar: HTMLElement } & Record<
  string,
  HTMLElement | Record<string, HTMLElement>
>;

export type SceneProps = {
  className?: string;
  /** Default true: plays while at least 40% visible, pauses offscreen. */
  autoplay?: boolean;
  /** Holds scene time where it is, as offscreen does: a section keeps its demo back until its entrance lands. */
  paused?: boolean;
  /**
   * The one window a visitor may use. It plays its demo once, holds the last frame and then hands
   * the app over: pointer, keyboard and tab order, with the state the demo left. Until then, and
   * in every window without it, the scene is animation only and the pointer passes to the page.
   */
  usable?: boolean;
  onReady?: (anchors: SceneAnchors) => void;
  /** The end of each loop's main beat. With `usable`, the moment the app becomes the visitor's. */
  onDone?: () => void;
  /** `usable` only: the demo reached its nth beat (from 0), for a page that narrates it. */
  onBeat?: (beat: number) => void;
  /** `usable` only: ends the demo at once on its last frame, as reduced motion shows it, and hands the app over. */
  skip?: boolean;
};
