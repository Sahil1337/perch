import type { Ref } from "react";
import { cn } from "../../shared/cn";
import { Reveal } from "../../shared/motion";
import { InstallCommand } from "../../shared/release";
import { Section, SectionHeading, SectionScene } from "../layout/section";
import { code, small } from "../layout/type";
import { BuildList } from "./download/build-list";
import { FirstRunNotes } from "./download/first-run-notes";
import { ReturnKey } from "./download/return-key";

export type DownloadProps = {
  /** The bird's last perch: the return key. */
  perchRef: Ref<HTMLElement>;
  onCopy: () => void;
};

const subheading = "text-base font-medium text-foreground";

// From lg the whole section, heading to the last note, fits one 720px-high screen under the nav.
export function DownloadSection({ perchRef, onCopy }: DownloadProps) {
  return (
    <Section id="download" labelledBy="get-title" dawn>
      <SectionHeading id="get-title" title="Get Perch." wide>
        One command on macOS and Linux. It fetches the build for your machine, checks it against the release’s
        checksums, and puts <code className={code}>perch</code> on your PATH.
      </SectionHeading>
      {/* Under sm the lede can run to the key's end of the line, so the row drops a little further to
          leave the bird room to stand on the key. */}
      <SectionScene wide className="max-sm:mt-12">
        <InstallCommand
          onCopy={onCopy}
          action={({ copied, copy }) => <ReturnKey perchRef={perchRef} copied={copied} onPress={copy} />}
          className="h-14 py-0 pr-1.5 pl-4 sm:pl-5 sm:text-base lg:h-18 lg:pr-2 lg:pl-6"
        />
        {/* Under sm the line keeps clear of the lane the key's Copied slip comes out into. */}
        <p className={cn(small, "mt-3 max-sm:pr-20")}>
          Already installed? Run <code className={code}>perch update</code>.
        </p>
      </SectionScene>
      <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16 lg:mt-10">
        <Reveal delay={0.12}>
          <h3 className={subheading}>Or download a build</h3>
          <p className={cn(small, "mt-1")}>Every platform from the latest release, with its checksums.</p>
          <BuildList className="mt-4" />
        </Reveal>
        <Reveal delay={0.2}>
          <h3 className={subheading}>The first run</h3>
          <p className={cn(small, "mt-1")}>The binaries aren’t signed yet, so a browser download gets one warning.</p>
          <FirstRunNotes className="mt-4" />
        </Reveal>
      </div>
    </Section>
  );
}
