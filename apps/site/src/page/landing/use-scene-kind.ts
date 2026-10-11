import { useSyncExternalStore } from "react";

export type SceneKind = "keys" | "grid";

// The keys need a desktop's width beside the copy; under lg (64rem) the grid bird takes the view.
const KEYS = "(min-width: 64rem)";

function subscribe(onChange: () => void): () => void {
  const query = matchMedia(KEYS);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const read = (): SceneKind => (matchMedia(KEYS).matches ? "keys" : "grid");

/** Which scene the landing shows, read synchronously on the first render so the wrong one never flashes. */
export function useSceneKind(): SceneKind {
  return useSyncExternalStore(subscribe, read);
}
