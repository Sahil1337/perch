import { WalkScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionHeading, SectionScene } from "../layout/section";
import { WalkPiece } from "./walk/piece";

export function WalkSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="query-walk" labelledBy="walk-title">
      <SectionHeading
        id="walk-title"
        title="Watch a SELECT build its answer."
        side="end"
        piece={<WalkPiece perchRef={perchRef} />}
      >
        Query Walk steps through your query clause by clause and shows the rows your database returns at each stage, and
        what changed. It runs read-only, against your real data.
      </SectionHeading>
      <SectionScene side="end">
        <WalkScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}
