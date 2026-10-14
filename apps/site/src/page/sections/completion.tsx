import { CompletionScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionText } from "../layout/section";
import { Stage, StagePiece } from "../layout/stage";
import { CompletionPiece } from "./completion/piece";

export function CompletionSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="features" labelledBy="completion-title" stage>
      <Stage
        side="end"
        text={
          <SectionText id="completion-title" title="Completion that reads your query.">
            After JOIN, the tables related to the ones already in the statement come first. Type ON and the join condition
            is offered already written, straight from the foreign key.
          </SectionText>
        }
        below={
          <StagePiece>
            <CompletionPiece perchRef={perchRef} />
          </StagePiece>
        }
        scene={(held) => <CompletionScene paused={held} onDone={onSceneDone} />}
      />
    </Section>
  );
}
