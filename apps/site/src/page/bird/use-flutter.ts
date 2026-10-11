import { useCallback } from "react";
import { useBird } from "../../shared/bird";

/** A flutter, for a successful copy of the install command. */
export function useFlutter(): () => void {
  const bird = useBird();
  return useCallback(() => bird?.flutter(), [bird]);
}
