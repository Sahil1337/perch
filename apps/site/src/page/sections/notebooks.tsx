import { NotebookScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionText } from "../layout/section";
import { Stage, StagePiece } from "../layout/stage";
import { code } from "../layout/type";
import { NotebookPiece } from "./notebooks/piece";

export function NotebookSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="notebooks" labelledBy="notebooks-title" stage>
      <Stage
        text={
          <SectionText id="notebooks-title" title="Notebooks that are still .sql files.">
            Split a file into cells with <code className={code}>--&nbsp;%%</code>. Each cell runs on its own and keeps its
            own results. On disk it’s the same plain .sql file, so it diffs, greps and commits like any other.
          </SectionText>
        }
        below={
          <StagePiece>
            <NotebookPiece perchRef={perchRef} />
          </StagePiece>
        }
        scene={(held) => <NotebookScene paused={held} onDone={onSceneDone} />}
      />
    </Section>
  );
}
