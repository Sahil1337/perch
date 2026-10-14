import { OS_NAMES, type Release } from "../../../shared/release";

/** One line printed on the tag. Its text is undefined until the release says, and prints as a blank. */
export type TagRow = {
  text: string | undefined;
  tone: "muted" | "ink" | "strong";
};

/**
 * The tag's four lines, from the release: the version, this machine's system and chip, and the size
 * of its build. A phone, or a system Perch has no build for, gets the three systems there are.
 */
export function tagRows({ version, os, mobile, primary }: Release): TagRow[] {
  const head: TagRow = { text: version, tone: "muted" };
  if (mobile || os === "unknown") {
    return [head, ...Object.values(OS_NAMES).map((text): TagRow => ({ text, tone: "ink" }))];
  }
  // An asset's label is "macOS · Apple silicon": the system, then the chip.
  const chip = primary?.label.split(" · ")[1];
  return [
    head,
    { text: OS_NAMES[os], tone: "ink" },
    { text: chip, tone: "ink" },
    { text: primary?.sizeLabel, tone: "strong" },
  ];
}
