import { ARCH_NAMES, OS_NAMES, type Release } from "../../../shared/release";

/** One line printed on the tag. Its text is undefined until the release says, and prints as a blank. */
export type TagRow = {
  text: string | undefined;
  tone: "muted" | "ink" | "strong";
};

/**
 * The tag's four lines, from the release: the version, this machine's system and chip, and the size
 * of its build. A phone, or a system Perch has no build for, gets the three systems there are.
 */
export function tagRows({ version, os, mobile, binary }: Release): TagRow[] {
  const head: TagRow = { text: version, tone: "muted" };
  if (mobile || os === "unknown") {
    return [head, ...Object.values(OS_NAMES).map((text): TagRow => ({ text, tone: "ink" }))];
  }
  // The binary, not the Windows installer: the tag hangs on the one executable.
  const chip = binary && ARCH_NAMES[binary.os][binary.arch];
  return [
    head,
    { text: OS_NAMES[os], tone: "ink" },
    { text: chip, tone: "ink" },
    { text: binary?.sizeLabel, tone: "strong" },
  ];
}
