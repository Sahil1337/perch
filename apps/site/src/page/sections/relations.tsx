import { RelationsScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionHeading, SectionScene } from "../layout/section";
import { RelationsPiece } from "./relations/piece";

export function RelationsSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="relationships" labelledBy="relations-title">
      <SectionHeading
        id="relations-title"
        title="See how your tables connect."
        piece={<RelationsPiece perchRef={perchRef} />}
      >
        Relationship View draws your foreign keys as a diagram. Drag tables to rearrange them, click one to focus on
        what it touches.
      </SectionHeading>
      <SectionScene>
        <RelationsScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}
