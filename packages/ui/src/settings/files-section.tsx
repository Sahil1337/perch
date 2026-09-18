// Settings → Files. Autosave, its delay, and the workspace roots list — the only folders Perch
// may read or write, which is why that fact is said once, plainly, rather than repeated by every
// control underneath it.

import type { Settings } from "@perch/protocol";
import { FolderOpenIcon, TrashIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { useWorkspace } from "../workspace/context";
import { FolderPicker } from "../workspace/folder-picker";
import { NumberSetting, SettingRow } from "./setting-controls";
import type { SettingsWriter } from "./saved-tick";

export function FilesSection({
  settings,
  writer,
}: {
  settings: Settings;
  writer: SettingsWriter;
}): React.ReactElement {
  const { roots } = useWorkspace();
  const [path, setPath] = React.useState("");
  const [picking, setPicking] = React.useState(false);

  function open(folder: string): void {
    const value = folder.trim();
    if (value.length === 0 || roots.includes(value)) return;
    writer.write({ workspaces: [...roots, value] });
  }

  function add(): void {
    open(path);
    setPath("");
  }

  return (
    <>
      <SettingRow description="Flushes a file buffer to disk on its own." title="Autosave">
        <Switch
          checked={settings.autosave}
          onCheckedChange={(checked) => writer.write({ autosave: checked })}
        />
      </SettingRow>

      <SettingRow
        description="How long to wait after the last keystroke."
        htmlFor="setting-autosave-delay"
        title="Autosave delay"
      >
        <NumberSetting
          id="setting-autosave-delay"
          max={60000}
          min={100}
          onCommit={(autosaveDelayMs) => writer.write({ autosaveDelayMs })}
          unit="ms"
          value={settings.autosaveDelayMs}
        />
      </SettingRow>

      <div className="flex flex-col gap-2 py-2">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-sm">Workspaces</span>
          {/* One line, and it is the one fact that is not on screen already: this list is the
              server's read/write boundary. That these are folders, that they hold .sql files and
              that the input wants an absolute path are all said by the list, the Open folder
              button and the placeholder underneath — saying them again is the reader's time spent
              on what they can see. */}
          <span className="text-muted-foreground text-xs">
            The only folders Perch may read or write.
          </span>
        </div>

        {roots.length === 0 ? (
          <p className="rounded-md border border-border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
            No folder open.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {roots.map((root) => (
              <li
                className="flex h-9 items-center gap-2 rounded-md border border-border px-2"
                key={root}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{root}</span>
                <Button
                  aria-label={`Remove ${root}`}
                  onClick={() => writer.write({ workspaces: roots.filter((item) => item !== root) })}
                  size="icon-xs"
                  variant="ghost"
                >
                  <TrashIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Button
          className="self-start"
          onClick={() => setPicking(true)}
          size="sm"
          variant="outline"
        >
          <FolderOpenIcon />
          Open folder…
        </Button>
        <FolderPicker onOpenChange={setPicking} onPick={open} open={picking} />

        <div className="flex items-center gap-2">
          <Input
            aria-label="New workspace path"
            autoComplete="off"
            className="flex-1"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add();
            }}
            onValueChange={setPath}
            placeholder="/Users/you/queries"
            size="sm"
            spellCheck={false}
            value={path}
          />
          <Button disabled={path.trim().length === 0} onClick={add} size="sm" variant="outline">
            Add
          </Button>
        </div>
      </div>
    </>
  );
}
