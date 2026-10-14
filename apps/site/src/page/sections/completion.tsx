import { CompletionScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionHeading, SectionScene } from "../layout/section";
import { CompletionPiece } from "./completion/piece";

export function CompletionSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="features" labelledBy="completion-title">
      <SectionHeading
        id="completion-title"
        title="Completion that reads your query."
        piece={<CompletionPiece perchRef={perchRef} />}
      >
        After JOIN, the tables related to the ones already in the statement come first. Type ON and the join condition
        is offered already written, straight from the foreign key.
      </SectionHeading>
      <SectionScene>
        <CompletionScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}
