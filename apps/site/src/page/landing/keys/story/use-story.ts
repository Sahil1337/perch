import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import type { Bird } from "../../../../shared/bird";
import { type Beat, END } from "../overlay/query";
import type { Rig } from "../rig";
import { ignoreCancelled, Run } from "./run";
import { intro, type Stage } from "./script";

// How long the intro waits for the bird before it plays without one.
const BIRD_WAIT_MS = 2200;
// An intro that would only start this long after the page opened is a remount (the window crossed
// the breakpoint) or a very slow load: the settled frame is calmer than a replay.
const LATE_MS = 6000;

export type StoryOptions = {
  /** The scene has been laid out. */
  ready: boolean;
  bird: Bird | null;
  reduced: boolean;
  play: () => Stage | null;
  setBeat: Dispatch<SetStateAction<Beat>>;
  onSettled: () => void;
};

export type Story = {
  /** The intro is over, skipped or cut short. */
  settled: boolean;
  /** Ends an intro that is playing where it would have ended. */
  cut: () => void;
};

/**
 * The intro, played once, and the settled scene it ends on: the whole query, the rows stacked, the
 * bird on its home key, put back there whenever it comes back to the landing.
 */
export function useStory(rig: Rig, { ready, bird, reduced, play, setBeat, onSettled }: StoryOptions): Story {
  const [settled, setSettled] = useState(false);
  const [waited, setWaited] = useState(false);
  const playing = useRef<Run | null>(null);
  const started = useRef(false);

  const finish = useCallback(() => {
    setSettled(true);
    onSettled();
  }, [onSettled]);

  const end = useCallback(() => {
    setBeat(END);
    rig.slips.current?.settle();
    rig.home.current = "return";
    finish();
  }, [rig, setBeat, finish]);

  const cut = useCallback(() => {
    const run = playing.current;
    if (!run) return;
    playing.current = null;
    run.cancel();
    end();
  }, [end]);

  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), BIRD_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || started.current || (!bird && !waited && !reduced)) return;
    started.current = true;
    const scene = play();
    if (!scene || reduced || bird?.reducedMotion || !rig.live.current || performance.now() > LATE_MS) {
      end();
      return;
    }
    const run = new Run();
    playing.current = run;
    intro(scene, run).then(() => {
      if (playing.current !== run) return;
      playing.current = null;
      finish();
    }, ignoreCancelled);
  }, [ready, bird, waited, reduced, rig, play, end, finish]);

  // Unmounting ends the intro; a remount (development's double mount) may start it afresh.
  useEffect(
    () => () => {
      playing.current?.cancel();
      playing.current = null;
      started.current = false;
    },
    [],
  );

  // Settled, the bird stands on its home key: put there when it arrives after an intro that played
  // without it, or comes back from the page's route without the hand-over to bring it home.
  useEffect(() => {
    if (!settled || !bird || rig.handedOver.current) return;
    const home = rig.anchors.current[rig.home.current];
    if (!home) return;
    if (bird.perch?.el !== home) void bird.appear(home, { at: 0.5, facing: "left" });
    rig.sculpture.current?.setOccupied(rig.home.current);
  }, [settled, bird, rig]);

  return { settled, cut };
}
