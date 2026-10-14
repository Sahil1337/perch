import type { ReactNode, Ref } from "react";
import { cn } from "../../shared/cn";
import { Reveal } from "../../shared/motion";
import { Container } from "./container";
import { Perch } from "./perch";
import { body, heading } from "./type";

// The one section anatomy, applied to every section below the hero:
//
//        48                      32 under lg
//   H2 + at most ~3 lines of body  |  piece (from lg, in the other half)
//        48                      32 under lg
//   scene
//
// Under lg a piece comes after the body. Sections sit 128px apart (80 under lg), and the space above
// each heading is headroom for the bird standing on the section's piece, so the gap between two
// sections is always well over twice the gaps inside one and each reads as a unit. These components
// are the only place those numbers live; a section never sets its own vertical spacing. An anchor
// jump stops that headroom below the nav (the page's scroll padding is the nav's height, which also
// keeps a focused control from scrolling in under it), so the bird stays in view.

export type SectionProps = {
  id: string;
  /** The id of the section's H2. */
  labelledBy: string;
  /** For a section with no piece: a line that stands for its heading, which the bird perches on. */
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
      <Container>
        <div className="relative pt-8 lg:pt-12">
          {perchRef ? <Perch ref={perchRef} section /> : null}
          {children}
        </div>
      </Container>
    </section>
  );
}

/** A feature section's wiring: the bird's perch on its piece, and a hop when its scene finishes. */
export type FeatureSectionProps = {
  perchRef: Ref<HTMLElement>;
  /** The scene finished a beat: the bird hops, if it is standing in this section. */
  onSceneDone: () => void;
};

export type SectionHeadingProps = {
  id: string;
  title: ReactNode;
  /** At most ~3 lines at desktop width. */
  children?: ReactNode;
  /** Which half of the page the block sits in from lg up; the text itself is always left-aligned. */
  side?: "start" | "end";
  /**
   * The section's piece, told in the landing's materials. From lg it fills the other half, beside
   * the heading; under lg it follows the body. It gets a fixed box, 176px tall under lg and 288px
   * from lg, and must lay itself out inside it.
   */
  piece?: ReactNode;
  /** No piece, and the body runs across the page in two lines rather than three, to save height. */
  wide?: boolean;
  className?: string;
};

export function SectionHeading({ id, title, children, side = "start", piece, wide, className }: SectionHeadingProps) {
  const text = (
    <>
      <h2 id={id} className={heading}>
        {title}
      </h2>
      {children ? <p className={cn(body, "mt-4 lg:mt-6", wide && "lg:max-w-3xl")}>{children}</p> : null}
    </>
  );
  if (wide) return <Reveal className={className}>{text}</Reveal>;
  if (!piece) {
    return <Reveal className={cn("lg:w-1/2", side === "end" && "lg:ml-auto", className)}>{text}</Reveal>;
  }
  return (
    <div className={cn("lg:grid lg:grid-cols-2 lg:items-center lg:gap-x-8", className)}>
      <Reveal className={cn("lg:row-start-1", side === "end" && "lg:col-start-2")}>{text}</Reveal>
      <Reveal
        delay={0.06}
        data-section-piece=""
        className={cn("relative mt-8 h-44 lg:row-start-1 lg:mt-0 lg:h-72", side === "end" && "lg:col-start-1")}
      >
        {piece}
      </Reveal>
    </div>
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
      data-section-scene=""
      className={cn("mt-8 lg:mt-12", !wide && "lg:max-w-260", !wide && side === "end" && "lg:ml-auto", className)}
    >
      {children}
    </Reveal>
  );
}
