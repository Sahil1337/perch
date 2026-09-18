// Settings → Appearance. Theme is stored on the server, so every browser pointed at this machine
// agrees; editor font size is a per-browser convenience and is stored locally instead.

import type { Settings } from "@perch/protocol";
import * as React from "react";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingRow } from "./setting-controls";
import { EDITOR_FONT_SIZES, useEditorFontSize } from "./use-editor-font-size";
import type { SettingsWriter } from "./saved-tick";

const THEMES: readonly { value: Settings["theme"]; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function AppearanceSection({
  settings,
  writer,
}: {
  settings: Settings;
  writer: SettingsWriter;
}): React.ReactElement {
  const [fontSize, setFontSize] = useEditorFontSize();

  return (
    <>
      <div className="flex flex-col gap-2 py-2">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-sm">Theme</span>
          <span className="text-muted-foreground text-xs">
            Stored on the server, so every browser pointed at this machine agrees.
          </span>
        </div>
        <RadioGroup
          onValueChange={(value) => writer.write({ theme: value as Settings["theme"] })}
          value={settings.theme}
        >
          {THEMES.map((theme) => (
            <label className="flex cursor-pointer items-center gap-2 text-sm" key={theme.value}>
              <Radio value={theme.value} />
              {theme.label}
            </label>
          ))}
        </RadioGroup>
      </div>

      <SettingRow
        description="Applies to the query editor only. Stored in this browser, not on the server."
        title="Editor font size"
      >
        <Select
          items={Object.fromEntries(EDITOR_FONT_SIZES.map((size) => [String(size), `${size}px`]))}
          onValueChange={(value) => setFontSize(Number(value))}
          value={String(fontSize)}
        >
          <SelectTrigger className="w-28" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {EDITOR_FONT_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}px
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </SettingRow>
    </>
  );
}
