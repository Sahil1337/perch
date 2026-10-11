export type SceneAnchors = { window: HTMLElement; titlebar: HTMLElement } & Record<
  string,
  HTMLElement | Record<string, HTMLElement>
>;

export type SceneProps = {
  className?: string;
  /** Default true: plays while at least 40% visible, pauses offscreen. */
  autoplay?: boolean;
  /**
   * The one window a visitor may use. It plays its demo once, holds the last frame and then hands
   * the app over: pointer, keyboard and tab order, with the state the demo left. Until then, and
   * in every window without it, the scene is animation only and the pointer passes to the page.
   */
  usable?: boolean;
  onReady?: (anchors: SceneAnchors) => void;
  /** The end of each loop's main beat. With `usable`, the moment the app becomes the visitor's. */
  onDone?: () => void;
};
