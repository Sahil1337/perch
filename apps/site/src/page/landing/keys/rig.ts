import { createRef, type RefObject, useState } from "react";
import type { Bird } from "../../../shared/bird";
import type { KeyId } from "./keymap";
import type { SceneLayout } from "./layout";
import type { Beat } from "./overlay/query";
import type { SlipsHandle } from "./overlay/slips";
import type { Sculpture } from "./sculpture/sculpture";
import type { Stage } from "./story/script";

/** The scene's moving parts, shared by the hooks that play it. Made once per mount. */
export type Rig = {
  /** Where the sculpture puts its canvas. */
  host: RefObject<HTMLDivElement | null>;
  /** A box as wide as the page container's content: the composition never leaves it. */
  column: RefObject<HTMLDivElement | null>;
  query: RefObject<HTMLDivElement | null>;
  slips: RefObject<SlipsHandle | null>;
  /** One element per key, kept on the key's top for the bird to perch on. */
  anchors: RefObject<Partial<Record<KeyId, HTMLDivElement | null>>>;
  sculpture: RefObject<Sculpture | null>;
  layout: RefObject<SceneLayout | null>;
  /** On screen, with the tab showing: nothing plays otherwise. */
  live: RefObject<boolean>;
  /** The key the bird goes back to. */
  home: RefObject<KeyId>;
  /** The bird has left the keys for the try window. */
  handedOver: RefObject<boolean>;
};

export function useRig(): Rig {
  const [rig] = useState<Rig>(() => ({
    host: createRef(),
    column: createRef(),
    query: createRef(),
    slips: createRef(),
    anchors: { current: {} },
    sculpture: createRef(),
    layout: createRef(),
    live: { current: true },
    home: { current: "return" },
    handedOver: { current: false },
  }));
  return rig;
}

/** What the script plays on, or null while there is no sculpture to play on. */
export function stageOf(rig: Rig, bird: Bird | null, set: (next: Partial<Beat>) => void): Stage | null {
  const sculpture = rig.sculpture.current;
  if (!sculpture) return null;
  return {
    bird,
    sculpture,
    anchor: (id) => rig.anchors.current[id] ?? null,
    set,
    menu: () => rig.query.current?.querySelector("[data-menu]") ?? null,
    query: () => rig.query.current,
    stomp: async () => {
      sculpture.press("return", 3);
      sculpture.ripple("return", 1.2);
      await rig.slips.current?.burst(sculpture.anchor("return"));
    },
  };
}
