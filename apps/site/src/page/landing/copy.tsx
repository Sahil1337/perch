import { Fragment } from "react";
import { cn } from "../../shared/cn";
import { DownloadButton, InstallCommand } from "../../shared/release";
import { body, display } from "../layout/type";
import type { CopyParts, CopyPlacement } from "./types";

const TITLE = ["A", "quiet", "place", "to", "write", "SQL."];

export type LandingCopyProps = {
  parts: CopyParts;
  placement: CopyPlacement;
  /** A successful copy of the install command. */
  onCopy: () => void;
};

/** The first view's words and its two actions, the same over either scene. */
export function LandingCopy({ parts, placement, onCopy }: LandingCopyProps) {
  return (
    <div ref={parts.root} className={cn("relative z-20 flex flex-col", placement.copy)}>
      <h1 ref={parts.title} id="landing-title" className={display}>
        {TITLE.map((word, index) => (
          <Fragment key={word}>
            {index > 0 && " "}
            <span data-word>{word}</span>
          </Fragment>
        ))}
      </h1>
      {/* Each sentence balances on its own, so no line break ever splits a phrase. */}
      <p ref={parts.lede} className={cn(body, "mt-4 sm:mt-6")}>
        <span className="block text-balance">An editor that knows your PostgreSQL or MySQL schema.</span>{" "}
        <span className="block text-balance">It runs on your machine and needs no account.</span>
      </p>
      <div
        ref={parts.cta}
        className={cn("mt-8 flex w-full flex-col gap-2 text-left sm:flex-row sm:gap-3 lg:mt-10", placement.cta)}
      >
        <InstallCommand onCopy={onCopy} className="h-11 py-0 pr-1.25 sm:flex-1" />
        <DownloadButton className="h-11 shrink-0 px-5" />
      </div>
    </div>
  );
}
