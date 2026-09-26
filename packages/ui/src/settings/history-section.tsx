// Settings → History.
//
// Three questions, in the order they matter: whether runs are recorded at all, how much of each one
// is kept, and how much of it is kept for how long. The middle one is the reason this pane exists —
// storing result rows means a copy of what the database returned lives in ~/.perch, and that is a
// decision rather than a default, so it is opt-in and says what it costs.
//
// The size is read when the pane opens and after a clear, not polled: it is a number you look at
// when you came here to look at it.

import type { HistoryMode, Settings } from "@perch/protocol";
import { Trash2Icon } from "lucide-react";
import * as React from "react";
import { messageOf } from "../lib/errors";
import { Button } from "../ui/button";
import { Radio, RadioGroup } from "../ui/radio-group";
import { useWorkspace } from "../workspace/context";
import { NumberSetting, SettingRow } from "./setting-controls";
import type { SettingsWriter } from "./saved-tick";

const MODES: readonly { value: HistoryMode; label: string; hint: string }[] = [
  { value: "off", label: "Don't record runs", hint: "Nothing is written. The History tab stays empty." },
  {
    value: "queries",
    label: "Record queries only",
    hint: "The SQL, when it ran, how long it took and how many rows came back — never the rows.",
  },
  {
    value: "results",
    label: "Record queries and results",
    hint: "Also keeps the rows, so an old run can be reopened and exported. They are compressed, and they are a copy of your data on disk.",
  },
];

/** Bytes as the pane says them: a size you glance at, not a number you do arithmetic with. */
function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function HistorySection({
  settings,
  writer,
}: {
  settings: Settings;
  writer: SettingsWriter;
}): React.ReactElement {
  const { historyStats, clearHistory } = useWorkspace();

  const [usage, setUsage] = React.useState<{ runs: number; bytes: number } | null>(null);
  const [clearing, setClearing] = React.useState(false);
  /** A destructive button asks once; the second press is on a button that has changed colour. */
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // In a ref so a provider rebuilding its closures each render cannot re-run the read.
  const read = React.useRef(historyStats);
  read.current = historyStats;

  const refresh = React.useCallback(() => {
    let cancelled = false;
    read.current().then(
      (stats) => {
        if (!cancelled) setUsage({ runs: stats.runs, bytes: stats.fileBytes });
      },
      (cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => refresh(), [refresh]);

  async function clear(): Promise<void> {
    setClearing(true);
    setError(null);
    try {
      await clearHistory();
      setConfirming(false);
      refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setClearing(false);
    }
  }

  const recording = settings.historyMode !== "off";

  return (
    <>
      <div className="flex flex-col gap-2 py-2">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-sm">What a run leaves behind</span>
          <span className="text-muted-foreground text-xs">
            Kept in {"~/.perch"}, readable only by you. Runs from the query walk are never recorded.
          </span>
        </div>
        <RadioGroup
          onValueChange={(value) => writer.write({ historyMode: value as HistoryMode })}
          value={settings.historyMode}
        >
          {MODES.map((mode) => (
            <label className="flex cursor-pointer items-start gap-2" key={mode.value}>
              <Radio className="mt-0.5" value={mode.value} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm">{mode.label}</span>
                <span className="text-muted-foreground text-xs">{mode.hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Both caps are off at zero, which the description says rather than the field implying it
          with a placeholder nobody reads. */}
      <SettingRow
        description="The oldest run is dropped once there are more than this. 0 keeps every run."
        htmlFor="setting-history-limit"
        title="Runs to keep"
      >
        <NumberSetting
          id="setting-history-limit"
          max={100000}
          min={0}
          onCommit={(historyLimit) => writer.write({ historyLimit })}
          value={settings.historyLimit}
        />
      </SettingRow>

      <SettingRow
        description="Runs are also dropped oldest-first once the store passes this. 0 means no size limit."
        htmlFor="setting-history-size"
        title="Size limit"
      >
        <NumberSetting
          id="setting-history-size"
          max={10000}
          min={0}
          onCommit={(historyMaxMb) => writer.write({ historyMaxMb })}
          unit="MB"
          value={settings.historyMaxMb}
        />
      </SettingRow>

      <SettingRow
        description={
          usage === null
            ? "Reading…"
            : usage.runs === 0
              ? recording
                ? "Nothing recorded yet."
                : "Nothing recorded, and not recording."
              : `${usage.runs} ${usage.runs === 1 ? "run" : "runs"}, ${readableSize(usage.bytes)} on disk.`
        }
        title="Stored history"
      >
        {confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button loading={clearing} onClick={() => void clear()} size="sm" variant="destructive">
              Delete all
            </Button>
          </>
        ) : (
          <Button
            disabled={usage === null || usage.runs === 0}
            onClick={() => setConfirming(true)}
            size="sm"
            variant="outline"
          >
            <Trash2Icon />
            Clear history
          </Button>
        )}
      </SettingRow>

      {error !== null && (
        <p className="text-destructive-foreground text-xs" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
