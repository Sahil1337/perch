import { type RefObject, useCallback } from "react";
import { useBirdNow } from "./driver";
import { sectionOf } from "./route";

/** A hop for a scene's onDone, when the route has the bird and it is standing in that perch's section. */
export function useHop(perch: RefObject<HTMLElement | null>): () => void {
  const birdNow = useBirdNow("route");
  return useCallback(() => {
    const bird = birdNow();
    const at = bird?.perch?.el;
    if (bird && at && perch.current && !bird.flying && sectionOf(perch.current).contains(at)) bird.hop();
  }, [birdNow, perch]);
}
