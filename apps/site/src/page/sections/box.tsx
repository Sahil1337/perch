import { type PointerEvent, type Ref, useRef } from "react";
import { Section, SectionHeading, SectionScene } from "../layout/section";
import { BoxList } from "./box/list";
import { BoxPane } from "./box/pane";
import { useShowcase } from "./box/use-showcase";

export type BoxProps = { perchRef: Ref<HTMLDivElement> };

const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * "Also in the box": a small window on the app beside the list of what else it does. From lg the
 * window sits in the left five columns and stays in view while the list scrolls past it; narrower,
 * it sits above the list.
 */
export function BoxSection({ perchRef }: BoxProps) {
  const pane = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const { active, shown, onCrop, point, release, pause } = useShowcase({ pane, list });
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
          {/* At lg the pane drops 6px so its top edge meets the first title's cap line, not its line box. */}
          <div className="lg:col-span-5">
            <BoxPane ref={pane} shown={shown} onCrop={onCrop} className="max-w-140 lg:sticky lg:top-24 lg:mt-1.5 lg:max-w-none" />
          </div>
          <div className="mt-12 lg:col-span-7 lg:mt-0">
            <BoxList ref={list} active={active} onPoint={point} onRelease={release} className="-my-4" />
          </div>
        </div>
      </SectionScene>
    </Section>
  );
}
