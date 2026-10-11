import type { Ref } from "react";
import { cn } from "../../shared/cn";
import { Reveal } from "../../shared/motion";
import { InstallCommand } from "../../shared/release";
import { Section, SectionHeading, SectionScene } from "../layout/section";
import { code, small } from "../layout/type";
import { BuildList } from "./download/build-list";
import { FirstRunNotes } from "./download/first-run-notes";

export type DownloadProps = {
  /** The bird's last perch: the top edge of the install command. */
  perchRef: Ref<HTMLDivElement>;
  onCopy: () => void;
};

const subheading = "text-base font-medium text-foreground";

export function DownloadSection({ perchRef, onCopy }: DownloadProps) {
  return (
    <Section id="download" labelledBy="get-title" dawn>
      <SectionHeading id="get-title" title="Get Perch.">
        One command on macOS and Linux. It fetches the build for your machine, checks it against the release’s
        checksums, and puts <code className={code}>perch</code> on your PATH.
      </SectionHeading>
      <SectionScene wide>
        <div ref={perchRef}>
          <InstallCommand onCopy={onCopy} className="h-12 py-0 pr-2 pl-4 sm:h-16 sm:pr-4 sm:pl-6 sm:text-base" />
        </div>
        <p className={cn(small, "mt-4")}>
          Already installed? Run <code className={code}>perch update</code>.
        </p>
      </SectionScene>
      <div className="mt-16 grid gap-12 md:grid-cols-2 md:gap-16 lg:mt-20">
        <Reveal delay={0.12}>
          <h3 className={subheading}>Or download a build</h3>
          <p className={cn(small, "mt-1")}>Every platform from the latest release, with its checksums.</p>
          <BuildList className="mt-5" />
        </Reveal>
        <Reveal delay={0.2}>
          <h3 className={subheading}>The first run</h3>
          <p className={cn(small, "mt-1")}>The binaries aren’t signed yet, so a browser download gets one warning.</p>
          <FirstRunNotes className="mt-5" />
        </Reveal>
      </div>
    </Section>
  );
}
