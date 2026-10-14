import { useEffect, useState } from "react";
import { onScrollFrame } from "../../shared/viewport/on-scroll-frame";

/** Whether the page has scrolled off its very top, read once a frame at most. */
export function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => onScrollFrame(() => setScrolled(scrollY > 4), { resize: false }).stop, []);
  return scrolled;
}
