"use client";

// The handover screen, available to the running app. The first run gets it from `Onboarding`, which
// returns it in place of itself; once the workspace is up there is nothing to return it instead of.
// The events that deserve it invalidate everything on screen — changing connection, or changing
// database — so covering the swap beats letting the panes repaint one at a time.
//
// `cover` takes the work rather than being a show/hide pair: with the promise in hand, "never leaves
// early" and "never leaves late" are the same line of code. A failure still lifts the screen, since
// the error belongs on the surface underneath.

import type { Dialect } from "@perch/protocol";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { ConnectingScreen, SWITCH_MS, SWITCH_STAGES } from "../onboarding/connecting-screen";
import { useFade } from "../lib/motion";

type Covering = {
  readonly dialect: Dialect;
  readonly name?: string;
  readonly title?: string;
  readonly stages: readonly string[];
  readonly durationMs: number;
};

export type ConnectingApi = {
  /**
   * Run `work` behind the handover screen. Resolves once the screen has gone, so a caller can
   * chain on it; rejects with whatever `work` rejected with, after the screen has gone.
   */
  cover: (
    options: {
      dialect: Dialect;
      name?: string;
      title?: string;
      stages?: readonly string[];
      durationMs?: number;
    },
    work: () => Promise<unknown>,
  ) => Promise<void>;
};

const ConnectingContext = React.createContext<ConnectingApi | null>(null);

/**
 * Available inside `<ConnectingProvider>`. Outside it this simply runs the work, so a surface that
 * covers a reconnect does not break when rendered without the overlay.
 */
export function useConnecting(): ConnectingApi {
  const value = React.useContext(ConnectingContext);
  return value ?? PASSTHROUGH;
}

const PASSTHROUGH: ConnectingApi = {
  cover: async (_options, work) => {
    await work();
  },
};

export function ConnectingProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [covering, setCovering] = React.useState<Covering | null>(null);
  // Resolved by the screen when its animation is over; `cover` waits on it alongside the work.
  const shown = React.useRef<(() => void) | null>(null);
  const fade = useFade();

  const cover = React.useCallback<ConnectingApi["cover"]>(async (options, work) => {
    const animated = new Promise<void>((resolve) => {
      shown.current = resolve;
    });

    setCovering({
      dialect: options.dialect,
      name: options.name,
      title: options.title,
      stages: options.stages ?? SWITCH_STAGES,
      durationMs: options.durationMs ?? SWITCH_MS,
    });

    try {
      // `allSettled`, so a rejection neither snaps the screen away nor goes unhandled. Re-thrown
      // below, once clear.
      const [result] = await Promise.all([
        work().then(
          (value) => ({ ok: true, value }) as const,
          (error: unknown) => ({ ok: false, error }) as const,
        ),
        animated,
      ]);

      if (!result.ok) throw result.error;
    } finally {
      shown.current = null;
      setCovering(null);
    }
  }, []);

  const api = React.useMemo<ConnectingApi>(() => ({ cover }), [cover]);

  return (
    <ConnectingContext.Provider value={api}>
      {children}
      <AnimatePresence>
        {covering && (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-100 bg-background"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="connecting"
            transition={fade}
          >
            <ConnectingScreen
              dialect={covering.dialect}
              durationMs={covering.durationMs}
              name={covering.name}
              onDone={() => shown.current?.()}
              stages={covering.stages}
              title={covering.title}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </ConnectingContext.Provider>
  );
}
