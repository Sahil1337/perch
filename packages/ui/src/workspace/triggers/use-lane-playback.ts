// The lane's player: where playback is, whether it is moving, and the one clock that moves it.
//
// Its state is keyed by everything the steps were built from — the table, the event, the rows, the
// columns an UPDATE sets, and when the schema was fetched — and a key that no longer matches reads
// as "at rest". So any change to what is being played resets it, in the same render, with no effect
// copying one piece of state into another.

import { useReducedMotion } from "motion/react";
import * as React from "react";
import type { Step } from "./lane-playback";
import { AUTOPLAY_DELAY_MS, stepMs } from "./lane-tempo";

type PlaybackState = { readonly key: string; readonly index: number; readonly playing: boolean };

export type LanePlayback = {
  /** The last step played; -1 at rest. */
  readonly index: number;
  readonly playing: boolean;
  /** The last step has played. */
  readonly finished: boolean;
  /** Play, pause, resume or replay, whichever the button currently says. */
  readonly toggle: () => void;
  /** One step forward, paused; from the end it starts over. */
  readonly step: () => void;
  /** The reader changed what is being played: the view will not start playing on its own now. */
  readonly touch: () => void;
};

export function useLanePlayback({
  steps,
  inputKey,
  settled,
}: {
  steps: readonly Step[];
  inputKey: string;
  /** Whether the schema has landed. Autoplay waits for it, so it never plays a stale lane. */
  settled: boolean;
}): LanePlayback {
  const reduced = useReducedMotion() ?? false;
  const [state, setState] = React.useState<PlaybackState>({
    key: inputKey,
    index: -1,
    playing: false,
  });
  const at = state.key === inputKey ? state : { key: inputKey, index: -1, playing: false };
  const last = steps.length - 1;
  const finished = at.index >= last && last >= 0;
  // Derived rather than cleared by the clock: at the last step there is nothing left to wait for.
  const playing = at.playing && !finished;

  const touched = React.useRef(false);
  const autoplayed = React.useRef(false);

  const current = steps[at.index];
  const delayMs = current ? stepMs(current.kind, reduced) : 0;
  React.useEffect(() => {
    if (!playing) return;
    const id = setTimeout(
      () => setState({ key: inputKey, index: at.index + 1, playing: true }),
      delayMs,
    );
    return () => clearTimeout(id);
  }, [at.index, delayMs, inputKey, playing]);

  // Once per open, a beat after the schema lands, unless the reader got there first. Not under
  // reduced motion: a lane that starts changing on its own is what that setting asks to avoid.
  React.useEffect(() => {
    if (!settled || reduced || autoplayed.current || touched.current || last < 0) return;
    const id = setTimeout(() => {
      if (touched.current) return;
      autoplayed.current = true;
      setState({ key: inputKey, index: 0, playing: true });
    }, AUTOPLAY_DELAY_MS);
    return () => clearTimeout(id);
  }, [inputKey, last, reduced, settled]);

  const toggle = React.useCallback(() => {
    touched.current = true;
    if (playing) setState({ key: inputKey, index: at.index, playing: false });
    else if (finished || at.index < 0) setState({ key: inputKey, index: 0, playing: true });
    else setState({ key: inputKey, index: at.index, playing: true });
  }, [at.index, finished, inputKey, playing]);

  const step = React.useCallback(() => {
    touched.current = true;
    setState({ key: inputKey, index: finished ? 0 : at.index + 1, playing: false });
  }, [at.index, finished, inputKey]);

  const touch = React.useCallback(() => {
    touched.current = true;
  }, []);

  return { index: at.index, playing, finished, toggle, step, touch };
}
