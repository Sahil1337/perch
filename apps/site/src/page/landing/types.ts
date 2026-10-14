import type { RefObject } from "react";
import type { Bird } from "../../shared/bird";
import type { TryWindow } from "../hand-over/try-window";
import type { CopyParts } from "./copy/types";

/** What the landing hands a scene: the props of each scene module's default export. */
export type LandingSceneProps = {
  /** The landing section. It is the positioned ancestor of whatever the scene draws. */
  stage: RefObject<HTMLElement | null>;
  copy: CopyParts;
  /** The bird while the landing drives it: null until it has loaded, and while the page's route has it. */
  bird: Bird | null;
  /** The real window under "Your turn", where the hand-over ends. */
  target: TryWindow;
  /** The intro is over, skipped or scrolled past: the window's app may load now. */
  onSettled: () => void;
};
