import { cn } from "../../shared/cn";
import { HeroScene } from "../../shared/scenes";
import { useHop } from "../bird/use-hop";
import { Perch } from "../layout/perch";
import { Container } from "../layout/container";
import { body, heading } from "../layout/type";
import { useMountWindow } from "./try/use-mount-window";
import { useTryWindow } from "./try/window";

export type TrySectionProps = {
  /** The landing's intro is over, skipped or scrolled past. */
  settled: boolean;
};

/** "Your turn": the real, usable editor the landing hands its query and rows to. */
export function TrySection({ settled }: TrySectionProps) {
  const { target, markRan } = useTryWindow();
  const mounted = useMountWindow(settled, target.frame);
  const hop = useHop(target.perch);
  return (
    <section id="try" aria-labelledby="try-title" className="relative pt-16 lg:pt-24">
      <Container>
        {/* Over the landing's layers, which pass in front of the window on their way into it. */}
        <div className="relative z-20">
          <h2 id="try-title" className={heading}>
            Your turn.
          </h2>
          <p className={cn(body, "mt-4 lg:mt-6")}>It’s the real editor, on a sample database.</p>
        </div>
        <div ref={target.frame} className="relative mt-8 lg:mt-12">
          <Perch ref={target.perch} />
          {mounted ? (
            <HeroScene
              usable
              onReady={(anchors) => {
                const pane = anchors.results;
                target.results.current = pane instanceof HTMLElement ? pane : null;
              }}
              onDone={() => {
                markRan();
                hop();
              }}
            />
          ) : (
            // The window's own box, held until the app may mount, so nothing below it moves.
            <div className="aspect-8/5 w-full rounded-lg bg-background shadow-(--bui-shadow-overlay)" />
          )}
        </div>
      </Container>
    </section>
  );
}
