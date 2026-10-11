import type { ReactNode, Ref } from "react";
import { cn } from "../../shared/cn";
import { Reveal } from "../../shared/motion";
import { Branch, Perch } from "./branch";
import { Container } from "./container";
import { body, heading } from "./type";

// The one section anatomy, applied to every section below the hero:
//
//   ───────────── branch (full bleed; the bird's perch)
//        48                      32 under lg
//   H2 + at most ~3 lines of body
//        48                      32 under lg
//   scene
//
// Sections sit 128px apart (80 under lg), so the gap between two sections is always well over twice
// the gaps inside one and each reads as a unit. These three components are the only place those
// numbers live; a section never sets its own vertical spacing. An anchor jump stops with the branch
// a bird's height below the nav (this margin on top of the page's scroll padding, which is the nav's
// height and also keeps a focused control from scrolling in under it), so the bird stays in view.

export type SectionProps = {
  id: string;
  /** The id of the section's H2. */
  labelledBy: string;
  /** The invisible line on the branch the bird stands on. */
  perchRef?: Ref<HTMLDivElement>;
  /** First light's dawn rises behind this section (a.css keeps a still version for reduced motion). */
  dawn?: boolean;
  className?: string;
  children: ReactNode;
};

export function Section({ id, labelledBy, perchRef, dawn, className, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      data-site-dawn={dawn || undefined}
      className={cn("relative mt-20 scroll-mt-14 lg:mt-32 lg:scroll-mt-16", className)}
    >
      <Branch />
      <Container>
        <div className="relative pt-8 lg:pt-12">
          <Perch ref={perchRef} />
          {children}
        </div>
      </Container>
    </section>
  );
}

export type SectionHeadingProps = {
  id: string;
  title: ReactNode;
  /** At most ~3 lines at desktop width. */
  children?: ReactNode;
  /** Which half of the page the block sits in from lg up; the text itself is always left-aligned. */
  side?: "start" | "end";
  className?: string;
};

export function SectionHeading({ id, title, children, side = "start", className }: SectionHeadingProps) {
  return (
    <Reveal className={cn("lg:w-1/2", side === "end" && "lg:ml-auto", className)}>
      <h2 id={id} className={heading}>
        {title}
      </h2>
      {children ? <p className={cn(body, "mt-4 lg:mt-6")}>{children}</p> : null}
    </Reveal>
  );
}

/**
 * The scene's slot under the heading: same gap everywhere, rising in just after the heading. From lg
 * a scene window is held to 1040px, so the tallest of them still fits a 900px-high view under the
 * nav, and it lines up with the heading's side of the page. `wide` is for what is not a window.
 */
export function SectionScene({
  side = "start",
  wide,
  className,
  children,
}: {
  side?: "start" | "end";
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Reveal
      delay={0.12}
      amount={0.15}
      className={cn("mt-8 lg:mt-12", !wide && "lg:max-w-260", !wide && side === "end" && "lg:ml-auto", className)}
    >
      {children}
    </Reveal>
  );
}
