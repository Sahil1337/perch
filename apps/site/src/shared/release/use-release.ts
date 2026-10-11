import { useSyncExternalStore } from "react";
import { getSnapshot, type Release, subscribe } from "./release";

/** The latest release and this visitor's platform; asked for once per page, cached per session. */
export function useRelease(): Release {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
