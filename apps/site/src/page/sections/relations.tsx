import { RelationsScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionText } from "../layout/section";
import { Stage, StagePiece } from "../layout/stage";
import { RelationsPiece } from "./relations/piece";

export function RelationsSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="relationships" labelledBy="relations-title" stage>
      <Stage
        side="end"
        text={
          <SectionText id="relations-title" title="See how your tables connect.">
            Relationship View draws your foreign keys as a diagram. Drag tables to rearrange them, click one to focus on
            what it touches.
          </SectionText>
        }
        below={
          <StagePiece>
            <RelationsPiece perchRef={perchRef} />
          </StagePiece>
        }
        scene={(held) => <RelationsScene paused={held} onDone={onSceneDone} />}
      />
    </Section>
  );
}
