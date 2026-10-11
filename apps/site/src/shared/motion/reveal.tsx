import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "./easing";

export type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Seconds after entering view, for staggering siblings. */
  delay?: number;
  /** How far it rises, in px. Default 12. */
  distance?: number;
  /** Share of the element that must be visible first. Default 0.2. */
  amount?: number;
  /** Plays every time it enters view rather than once. Default false. */
  repeat?: boolean;
  as?: "div" | "section" | "li" | "p" | "span" | "header" | "footer" | "article";
};


/**
 * Fades and rises into place the first time it scrolls into view: calm, ease-out, no overshoot.
 * Under prefers-reduced-motion it is simply there.
 */
export function Reveal({ children, className, delay = 0, distance = 12, amount = 0.2, repeat = false, as = "div" }: RevealProps) {
  const reduced = useReducedMotion();
  const Tag = motion[as];
  if (reduced) {
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: !repeat, amount }}
      transition={{ duration: 0.6, ease: EASE_OUT, delay }}
    >
      {children}
    </Tag>
  );
}
