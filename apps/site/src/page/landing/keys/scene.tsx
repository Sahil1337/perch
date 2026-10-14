import { useCallback, useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../../../shared/viewport/media";
import { Container } from "../../layout/container";
import type { LandingSceneProps } from "../types";
import { SUMMARY } from "./data";
import { KEYS } from "./keymap";
import { type Beat, Query, START } from "./overlay/query";
import { Slips } from "./overlay/slips";
import { stageOf, useRig } from "./rig";
import { useSculpture } from "./sculpture/use-sculpture";
import { useHandOver } from "./story/use-hand-over";
import { useIdle } from "./story/use-idle";
import { useLive } from "./story/use-live";
import { useStory } from "./story/use-story";

/**
 * Hunt & peck, the desktop landing: the bird types a query on a sculpture of porcelain keys, runs it
 * on return, and hands the query and its rows to the real window below as the page scrolls.
 */
export default function KeysScene({ stage, copy, bird, target, onSettled }: LandingSceneProps) {
  const rig = useRig();
  const reduced = usePrefersReducedMotion();
  const layout = useSculpture(rig, stage, copy);
  const [beat, setBeat] = useState<Beat>(START);
  const set = useCallback((next: Partial<Beat>) => setBeat((now) => ({ ...now, ...next })), []);
  const play = useCallback(() => stageOf(rig, bird, set), [rig, bird, set]);
  const { settled, cut } = useStory(rig, { ready: layout !== null, bird, reduced, play, setBeat, onSettled });
  const live = useLive(rig, stage, cut);
  useIdle(rig, { enabled: settled && live, bird, play });
  useHandOver(rig, { stage, target, bird, settled, cut, play });

  // The bird's flights stay under the sticky nav.
  useEffect(() => {
    bird?.setCeiling(document.querySelector("[data-site-nav]"));
    return () => bird?.setCeiling(null);
  }, [bird]);

  return (
    <>
      <div ref={rig.host} aria-hidden className="pointer-events-none absolute inset-0 -z-10" />
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {KEYS.map(({ id }) => (
          <div
            key={id}
            ref={(el) => {
              rig.anchors.current[id] = el;
            }}
            className="absolute top-0 left-0 h-px w-6"
          />
        ))}
      </div>
      <Container className="pointer-events-none absolute inset-x-0 top-0">
        <div ref={rig.column} />
      </Container>
      <div ref={rig.query} className="pointer-events-none absolute top-0 left-0 w-96 origin-top-left will-change-transform">
        <Query beat={beat} blink={live} />
        <p className="sr-only">{SUMMARY}</p>
      </div>
      {layout && <Slips ref={rig.slips} stack={layout.stack} />}
    </>
  );
}
