import { WalkScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionText } from "../layout/section";
import { Stage, StagePiece } from "../layout/stage";
import { WalkPiece } from "./walk/piece";

export function WalkSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="query-walk" labelledBy="walk-title" stage>
      <Stage
        text={
          <SectionText id="walk-title" title="Watch a SELECT build its answer.">
            Query Walk steps through your query clause by clause and shows the rows your database returns at each stage, and
            what changed. It runs read-only, against your real data.
          </SectionText>
        }
        below={
          <StagePiece>
            <WalkPiece perchRef={perchRef} />
          </StagePiece>
        }
        scene={(held) => <WalkScene paused={held} onDone={onSceneDone} />}
      />
    </Section>
  );
}
