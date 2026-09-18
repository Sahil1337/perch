// Settings → Query. Max rows and statement timeout are both caps the server applies, not
// something the UI asks for — the help text on each row says so, because "Max rows" alone reads
// like a page size.

import type { Settings } from "@perch/protocol";
import * as React from "react";
import { NumberSetting, SettingRow } from "./setting-controls";
import type { SettingsWriter } from "./saved-tick";

export function QuerySection({
  settings,
  writer,
}: {
  settings: Settings;
  writer: SettingsWriter;
}): React.ReactElement {
  return (
    <>
      <SettingRow
        description="The server stops reading a result set here. Raising it makes big selects slower, not truncated."
        htmlFor="setting-max-rows"
        title="Max rows"
      >
        <NumberSetting
          id="setting-max-rows"
          max={100000}
          min={100}
          onCommit={(maxRows) => writer.write({ maxRows })}
          value={settings.maxRows}
        />
      </SettingRow>

      <SettingRow
        description="Cancels a statement that runs longer than this. 0 means no limit."
        htmlFor="setting-timeout"
        title="Statement timeout"
      >
        <NumberSetting
          id="setting-timeout"
          max={3600000}
          min={0}
          onCommit={(statementTimeoutMs) => writer.write({ statementTimeoutMs })}
          unit="ms"
          value={settings.statementTimeoutMs}
        />
      </SettingRow>
    </>
  );
}
