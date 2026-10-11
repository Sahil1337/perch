import { type RefObject, useCallback } from "react";
import { useBirdFor } from "./driver";
import { sectionOf } from "./route";

/** A hop for a scene's onDone, when the bird is standing anywhere in that perch's section. */
export function useHop(perch: RefObject<HTMLElement | null>): () => void {
  const bird = useBirdFor("route");
  return useCallback(() => {
    const at = bird?.perch?.el;
    if (bird && at && perch.current && !bird.flying && sectionOf(perch.current).contains(at)) bird.hop();
  }, [bird, perch]);
}
