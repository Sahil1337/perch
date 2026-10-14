import type { Ref, RefObject } from "react";
import { cn } from "../../../shared/cn";
import { Reveal } from "../../../shared/motion";
import { Container } from "../../layout/container";
import { Perch } from "../../layout/perch";
import { heading, small } from "../../layout/type";
import { BOX_ITEMS } from "./items";
import { BoxList } from "./list";
import { BoxPane, type CropState } from "./pane";

// Half a view of scroll per item, rounded up to whole views of track: each spacer below the stage is
// one view tall, so the steps stay even without a height Tailwind can't name.
const SPACERS = Math.ceil(BOX_ITEMS.length / 2);

export type BoxStageProps = {
  perchRef: Ref<HTMLDivElement>;
  track: RefObject<HTMLDivElement | null>;
  stage: RefObject<HTMLDivElement | null>;
  pane: RefObject<HTMLDivElement | null>;
  list: RefObject<HTMLUListElement | null>;
  active: number;
  shown: string | null;
  onCrop: (key: string, state: CropState) => void;
  onPoint: (index: number, hover: boolean) => void;
};

/**
 * The pinned "Also in the box", from lg: a tall track with a stage that sticks under the nav for
 * one even step of scroll per item, holding the heading, the pane and the list in one view, centred.
 * The page's own scroll moves through the items; past the last one the stage lets go.
 *
 * The section spaces itself rather than going through `Section`, whose wrapper would sit outside the
 * sticky stage and leave the bird's perch behind on the heading's first position.
 */
export function BoxStage({ perchRef, track, stage, pane, list, active, shown, onCrop, onPoint }: BoxStageProps) {
  return (
    <section id="in-the-box" aria-labelledby="box-title" className="relative mt-32">
      <div ref={track} className="relative">
        <div ref={stage} className="sticky top-0 flex h-svh flex-col pt-16">
          <Container className="flex min-h-0 flex-1 flex-col justify-center py-12">
            <div className="relative shrink-0">
              <Perch ref={perchRef} section />
              <Reveal>
                <h2 id="box-title" className={heading}>
                  Also in the box.
                </h2>
              </Reveal>
            </div>
            {/* The row gives up height before the heading does, and the pane's height-to-width ratio
                carries that limit across to its width, so on a short view the pane narrows rather
                than overflowing. The pane drops 6px so its top edge meets the first title's cap line. */}
            <Reveal delay={0.12} amount={0.15} className="mt-10 grid min-h-0 grid-cols-12 gap-x-10">
              <div className="col-span-7 min-h-0 pt-1.5">
                <BoxPane ref={pane} shown={shown} onCrop={onCrop} className="aspect-60/49 max-h-full" />
              </div>
              <div className="col-span-5">
                <BoxList ref={list} active={active} onPoint={onPoint} pinned className="-mt-2" />
                <p aria-hidden className={cn(small, "mt-4 pl-5 tabular-nums")}>
                  {active + 1} / {BOX_ITEMS.length}
                </p>
              </div>
            </Reveal>
          </Container>
        </div>
        {Array.from({ length: SPACERS }, (_, index) => (
          <div key={index} aria-hidden className="h-svh" />
        ))}
      </div>
    </section>
  );
}
