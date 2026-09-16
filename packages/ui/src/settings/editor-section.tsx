"use client";

// Settings → Editor. The keyword-case row is not optional: these settings change what the
// formatter writes, and "Keyword case" alone does not say formatting is an explicit action rather
// than something that happens as you type.

import type { Settings } from "@perch/protocol";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useFade } from "../lib/motion";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingRow } from "./setting-controls";
import type { SettingsWriter } from "./saved-tick";

const KEYWORD_CASE_LABELS: Record<Settings["keywordCase"], string> = {
  preserve: "Preserve",
  upper: "UPPERCASE",
  lower: "lowercase",
};

/** Mixed on purpose: it is the only way "preserve" reads as different from "lowercase". */
const EXAMPLE = [
  { text: "Select", keyword: true },
  { text: " id, name ", keyword: false },
  { text: "FROM", keyword: true },
  { text: " users ", keyword: false },
  { text: "where", keyword: true },
  { text: " active = ", keyword: false },
  { text: "true", keyword: true },
] as const;

function recase(text: string, mode: Settings["keywordCase"]): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  return text;
}

export function EditorSection({
  settings,
  writer,
}: {
  settings: Settings;
  writer: SettingsWriter;
}): React.ReactElement {
  const fade = useFade();

  return (
    <>
      <SettingRow
        description="How the formatter writes keywords. Formatting is an explicit action — ⇧⌥F, or Format from the editor's context menu."
        title="Keyword case"
      >
        <Select
          items={KEYWORD_CASE_LABELS}
          onValueChange={(value) => writer.write({ keywordCase: value as Settings["keywordCase"] })}
          value={settings.keywordCase}
        >
          <SelectTrigger className="w-36" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {(Object.keys(KEYWORD_CASE_LABELS) as Settings["keywordCase"][]).map((option) => (
              <SelectItem key={option} value={option}>
                {KEYWORD_CASE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </SettingRow>

      <div className="relative flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Example</span>
        {/* See settings-dialog.tsx: `wait` empties the box between the two, and an empty box has
            no height, so the example collapsed and sprang back on every change. */}
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p
            animate={{ opacity: 1 }}
            className="overflow-x-auto whitespace-nowrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={settings.keywordCase}
            transition={fade}
          >
            {EXAMPLE.map((token, index) => (
              <span
                className={token.keyword ? "text-foreground" : "text-muted-foreground"}
                key={index}
              >
                {token.keyword ? recase(token.text, settings.keywordCase) : token.text}
              </span>
            ))}
          </motion.p>
        </AnimatePresence>
      </div>
    </>
  );
}
