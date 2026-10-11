import type { Ref } from "react";
import { CompletionScene, NotebookScene, RelationsScene, WalkScene } from "../../shared/scenes";
import { code } from "../layout/type";
import { Section, SectionHeading, SectionScene } from "../layout/section";

// The four feature sections. Each is the same anatomy (branch → heading → scene); only the side
// the heading sits on alternates.

type FeatureProps = {
  perchRef: Ref<HTMLDivElement>;
  /** The scene finished a beat: the bird hops, if it is standing on this section's branch. */
  onSceneDone: () => void;
};

export function CompletionSection({ perchRef, onSceneDone }: FeatureProps) {
  return (
    <Section id="features" labelledBy="completion-title" perchRef={perchRef}>
      <SectionHeading id="completion-title" title="Completion that reads your query.">
        After JOIN, the tables related to the ones already in the statement come first. Type ON and the join condition
        is offered already written, straight from the foreign key.
      </SectionHeading>
      <SectionScene>
        <CompletionScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}

export function WalkSection({ perchRef, onSceneDone }: FeatureProps) {
  return (
    <Section id="query-walk" labelledBy="walk-title" perchRef={perchRef}>
      <SectionHeading id="walk-title" title="Watch a SELECT build its answer." side="end">
        Query Walk steps through your query clause by clause and shows the rows your database returns at each stage, and
        what changed. It runs read-only, against your real data.
      </SectionHeading>
      <SectionScene side="end">
        <WalkScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}

export function RelationsSection({ perchRef, onSceneDone }: FeatureProps) {
  return (
    <Section id="relationships" labelledBy="relations-title" perchRef={perchRef}>
      <SectionHeading id="relations-title" title="See how your tables connect.">
        Relationship View draws your foreign keys as a diagram. Drag tables to rearrange them, click one to focus on
        what it touches.
      </SectionHeading>
      <SectionScene>
        <RelationsScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}

export function NotebookSection({ perchRef, onSceneDone }: FeatureProps) {
  return (
    <Section id="notebooks" labelledBy="notebooks-title" perchRef={perchRef}>
      <SectionHeading id="notebooks-title" title="Notebooks that are still .sql files." side="end">
        Split a file into cells with <code className={code}>--&nbsp;%%</code>. Each cell runs on its own and keeps its
        own results. On disk it’s the same plain .sql file, so it diffs, greps and commits like any other.
      </SectionHeading>
      <SectionScene side="end">
        <NotebookScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}
