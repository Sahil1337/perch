import { useEffect, useMemo, useRef, useState } from "react";
import type { LandingSceneProps } from "../types";
import { PorcelainBird } from "./bird/porcelain-bird";
import type { HandOver } from "./hand-over";
import { useGridScene } from "./use-grid-scene";

/**
 * The grid bird, the first view below lg: a dim result grid on a fixed layer under the copy, a bird
 * drawn out of it that lands on the headline and becomes the porcelain bird, and a hand-over that
 * shrinks the grid into the real window's results pane as the page scrolls.
 */
export default function GridBirdScene({ stage, copy, bird, target, onSettled }: LandingSceneProps) {
  const { frame, results, perch, ran } = target;
  const layer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const handOver = useRef<HandOver | null>(null);
  const ranRef = useRef(ran);
  const settledRef = useRef(onSettled);
  const [porcelain] = useState(() => new PorcelainBird(perch));
  const tryWindow = useMemo(() => ({ frame, results }), [frame, results]);

  useEffect(() => {
    settledRef.current = onSettled;
  });
  useEffect(() => {
    ranRef.current = ran;
    handOver.current?.setRan(ran);
  }, [ran]);
  useEffect(() => porcelain.setBird(bird), [porcelain, bird]);
  useGridScene({ layer, canvas, stage, copy, window: tryWindow, porcelain, ran: ranRef, onSettled: settledRef, handOver });

  return (
    <div ref={layer} aria-hidden className="pointer-events-none fixed inset-0 z-10 origin-top-left will-change-transform">
      <canvas
        ref={canvas}
        className="size-full opacity-0 transition-opacity duration-500 ease-out data-ready:opacity-100 motion-reduce:transition-none"
      />
    </div>
  );
}
