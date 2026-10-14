import { NotebookScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionHeading, SectionScene } from "../layout/section";
import { code } from "../layout/type";
import { NotebookPiece } from "./notebooks/piece";

export function NotebookSection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="notebooks" labelledBy="notebooks-title">
      <SectionHeading
        id="notebooks-title"
        title="Notebooks that are still .sql files."
        side="end"
        piece={<NotebookPiece perchRef={perchRef} />}
      >
        Split a file into cells with <code className={code}>--&nbsp;%%</code>. Each cell runs on its own and keeps its
        own results. On disk it’s the same plain .sql file, so it diffs, greps and commits like any other.
      </SectionHeading>
      <SectionScene side="end">
        <NotebookScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}
