import { motion } from "motion/react";
import { useRef, useState } from "react";
import { HeroScene } from "../../shared/scenes";
import { EASE_OUT } from "../../shared/motion";
import { useHop } from "../bird/use-hop";
import { Container } from "../layout/container";
import { Perch } from "../layout/perch";
import { SectionText } from "../layout/section";
import { Stage } from "../layout/stage";
import { type LockPillHandle, LockPill } from "./try/lock-pill";
import { TryRail, YOUR_STEP } from "./try/rail";
import { useMountWindow } from "./try/use-mount-window";
import { useTryWindow } from "./try/window";

export type TrySectionProps = {
  /** The landing's intro is over, skipped or scrolled past. */
  settled: boolean;
};

/**
 * "Your turn": the real, usable editor the landing hands its query and rows to. Its demo plays first,
 * narrated by the rail beside it, and a pill on the window says the editor is not the visitor's yet;
 * a press on the window meanwhile nudges the pill rather than doing nothing, and Skip ends the demo.
 */
export function TrySection({ settled }: TrySectionProps) {
  const { target, markRan } = useTryWindow();
  const mounted = useMountWindow(settled, target.frame);
  const hop = useHop(target.perch);
  const [beat, setBeat] = useState(-1);
  const [skipped, setSkipped] = useState(false);
  const [live, setLive] = useState(false);
  const pill = useRef<LockPillHandle>(null);

  return (
    <section id="try" aria-labelledby="try-title" className="relative pt-16 lg:pt-0 lg:motion-safe:snap-start">
      <Container>
        {/* Still: the landing's hand-over lands on this window, so it is in place from the first paint. */}
        <Stage
          still
          text={
            <SectionText id="try-title" title="Your turn.">
              It’s the real editor, on a sample database.
            </SectionText>
          }
          below={<TryRail at={live ? YOUR_STEP : beat} />}
          scene={() => (
            <div
              ref={target.frame}
              className="relative"
              onPointerDown={(event) => {
                const onPill = event.target instanceof Element && event.target.closest("[data-try-pill]");
                if (!live && !onPill) pill.current?.nudge();
              }}
            >
              <Perch ref={target.perch} />
              {mounted ? (
                <>
                  <HeroScene
                    usable
                    skip={skipped}
                    onBeat={setBeat}
                    onReady={(anchors) => {
                      const pane = anchors.results;
                      target.results.current = pane instanceof HTMLElement ? pane : null;
                    }}
                    onDone={() => {
                      setLive(true);
                      markRan();
                      hop();
                    }}
                  />
                  <LockPill ref={pill} live={live} onSkip={() => setSkipped(true)} />
                  {live ? (
                    // Once, as the editor becomes the visitor's.
                    <motion.div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-glaze"
                      initial={{ opacity: 0, scale: 1 }}
                      animate={{ opacity: [0, 0.9, 0], scale: [1, 1.015, 1.03] }}
                      transition={{ duration: 1.4, ease: EASE_OUT }}
                    />
                  ) : null}
                </>
              ) : (
                // The window's own box, held until the app may mount, so nothing below it moves.
                <div className="aspect-8/5 w-full rounded-lg bg-background shadow-(--bui-shadow-overlay)" />
              )}
            </div>
          )}
        />
      </Container>
    </section>
  );
}
