import { createContext, createRef, type ReactNode, type RefObject, useContext, useMemo, useState } from "react";

/** The real window under "Your turn": what the landing's hand-over lands on. */
export type TryWindow = {
  /** The window's box, which holds its size from the first paint, before the app inside has loaded. */
  frame: RefObject<HTMLDivElement | null>;
  /** The app's results pane, once the app has mounted. */
  results: RefObject<HTMLElement | null>;
  /** A line along the window's top edge: the bird's perch once the landing lets it go. */
  perch: RefObject<HTMLDivElement | null>;
  /** The demo has run its query, so the results pane shows rows. */
  ran: boolean;
};

type TryWindowState = {
  target: TryWindow;
  markRan: () => void;
};

const TryWindowContext = createContext<TryWindowState | null>(null);

/** Holds the try window's parts for the two sections that meet at it: the landing and "Your turn". */
export function TryWindowProvider({ children }: { children: ReactNode }) {
  const [refs] = useState(() => ({
    frame: createRef<HTMLDivElement>(),
    results: createRef<HTMLElement>(),
    perch: createRef<HTMLDivElement>(),
  }));
  const [ran, setRan] = useState(false);
  const value = useMemo(() => ({ target: { ...refs, ran }, markRan: () => setRan(true) }), [refs, ran]);
  return <TryWindowContext value={value}>{children}</TryWindowContext>;
}

export function useTryWindow(): TryWindowState {
  const value = useContext(TryWindowContext);
  if (!value) throw new Error("useTryWindow needs a TryWindowProvider above it.");
  return value;
}
