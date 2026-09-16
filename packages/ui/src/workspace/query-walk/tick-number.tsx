"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { useT } from "./walk-motion";

/** A number that tweens through the integers between its old and new value. */
export function TickNumber({
  value,
  from,
  duration = 0.6,
}: {
  value: number;
  from?: number;
  duration?: number;
}): React.ReactElement {
  const t = useT();
  const mv = useMotionValue(from ?? value);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: t.reduced ? 0 : duration, ease: "easeOut" });
    return () => controls.stop();
  }, [mv, value, duration, t.reduced]);
  return <motion.span>{text}</motion.span>;
}
