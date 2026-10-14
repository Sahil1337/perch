import { TerminalScene } from "../../shared/scenes";
import { type FeatureSectionProps, Section, SectionHeading, SectionScene } from "../layout/section";
import { code } from "../layout/type";
import { BinaryPiece } from "./binary/piece";

export function BinarySection({ perchRef, onSceneDone }: FeatureSectionProps) {
  return (
    <Section id="one-binary" labelledBy="binary-title">
      <SectionHeading
        id="binary-title"
        piece={<BinaryPiece perchRef={perchRef} />}
        title={
          <>
            <span className="block">One binary.</span> <span className="block">Nothing else to install.</span>
          </>
        }
      >
        A single 14&nbsp;MB executable with the interface built in. It runs on your machine and keeps everything it
        writes in <code className={code}>~/.perch</code>. Queries stay plain .sql files.
      </SectionHeading>
      {/* A terminal is a smaller window than the app: at full width it would sit mostly empty while
          the command is typed. */}
      <SectionScene className="lg:max-w-3xl">
        <TerminalScene onDone={onSceneDone} />
      </SectionScene>
    </Section>
  );
}
