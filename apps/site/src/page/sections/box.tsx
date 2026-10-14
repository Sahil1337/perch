import { type PointerEvent, type Ref, useRef } from "react";
import { Section, SectionHeading, SectionScene } from "../layout/section";
import { BoxList } from "./box/list";
import { BoxPane } from "./box/pane";
import { BoxStage } from "./box/stage";
import { useShowcase } from "./box/use-showcase";

export type BoxProps = { perchRef: Ref<HTMLDivElement> };

const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * "Also in the box": a window on the app beside the list of what else it does. From lg the section
 * pins (box/stage.tsx): heading, window and list hold still in one view while the scroll steps
 * through the items. With reduced motion there is no pin: the window, in the left seven columns,
 * stays in view while the list scrolls past it in the other five. Narrower, it sits above the list.
 */
export function BoxSection({ perchRef }: BoxProps) {
  const pane = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { pinned, active, shown, onCrop, point, release, pause } = useShowcase({ pane, list, track, stage });
  if (pinned) {
    return (
      <BoxStage
        perchRef={perchRef}
        track={track}
        stage={stage}
        pane={pane}
        list={list}
        active={active}
        shown={shown}
        onCrop={onCrop}
        onPoint={point}
      />
    );
  }
  return (
    <Section id="in-the-box" labelledBy="box-title" perchRef={perchRef}>
      <SectionHeading id="box-title" title="Also in the box." />
      <SectionScene wide>
        <div
          className="lg:grid lg:grid-cols-12 lg:gap-x-10"
          onPointerEnter={(event) => {
            if (isMouse(event)) pause(true);
          }}
          onPointerLeave={(event) => {
            if (isMouse(event)) pause(false);
          }}
        >
          {/* At lg the pane drops 6px so its top edge meets the first title's cap line, not its line box.
              Seven columns hold it to 683px of the 1200px crops, so it stays sharp, and 558px tall,
              so stuck 16px under the nav it still fits a 768px laptop's view once the browser's own
              bar has taken its share. */}
          <div className="lg:col-span-7">
            <BoxPane ref={pane} shown={shown} onCrop={onCrop} className="max-w-140 lg:sticky lg:top-20 lg:mt-1.5 lg:max-w-none" />
          </div>
          <div className="mt-12 lg:col-span-5 lg:mt-0">
            <BoxList ref={list} active={active} onPoint={point} onRelease={release} className="-my-4" />
          </div>
        </div>
      </SectionScene>
    </Section>
  );
}
