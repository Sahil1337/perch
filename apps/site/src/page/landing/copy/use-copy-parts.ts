import { createRef, useState } from "react";
import type { CopyParts } from "./types";

/** The copy's parts, made once for the landing's lifetime. */
export function useCopyParts(): CopyParts {
  const [parts] = useState<CopyParts>(() => ({
    root: createRef(),
    title: createRef(),
    lede: createRef(),
    cta: createRef(),
  }));
  return parts;
}
