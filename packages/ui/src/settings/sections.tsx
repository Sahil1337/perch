"use client";

// The panes behind the left nav, minus Connections (long enough to own a file). A row is a label,
// one line of help, and the control on the right. The help is not optional: these settings change
// what the server does to files or to a database, and "Max rows" alone does not say it is a cap the
// server applies rather than a page size the UI asks for.

import type { Settings } from "@perch/protocol";
import { FolderOpenIcon, TrashIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useFade } from "../lib/motion";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../ui/input-group";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useWorkspace } from "../workspace/context";
import { FolderPicker } from "../workspace/folder-picker";
import { EDITOR_FONT_SIZES, useEditorFontSize } from "./use-editor-font-size";
import type { SettingsWriter } from "./saved-tick";

/**
 * Every control in a settings row is this wide, so they share one column down the right edge: the
 * control's box is what the eye follows, and sizing each to its content reads as a list that failed
 * to line up. Units go inside the field for the same reason.
 */
const CONTROL_W = "w-28";

/* ------------------------------------------------------------------------------ the row form */

export function SettingRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description?: string;
  htmlFor?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label className="font-medium text-sm" htmlFor={htmlFor}>
          {title}
        </label>
        {description !== undefined && (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * A number that is only worth writing once it is a number: clearing "1000" to type "5000" would send
 * `maxRows: 1` on the way, and the server would take it. The field keeps its own text, clamps on
 * blur or Enter, and snaps back to what was stored.
 */
function NumberSetting({
  id,
  value,
  min,
  max,
  unit,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  /** Rendered inside the field, at its trailing edge, so the box stays in the column. */
  unit?: string;
  onCommit: (next: number) => void;
}): React.ReactElement {
  const [text, setText] = React.useState(String(value));
  const [editing, setEditing] = React.useState(false);

  // Mirrors the stored value while not being edited, so a failed write or an outside change shows.
  if (!editing && text !== String(value)) setText(String(value));

  function commit(): void {
    setEditing(false);
    const parsed = Number(text.trim());
    const next = Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), min), max) : value;
    setText(String(next));
    if (next !== value) onCommit(next);
  }

  const field = {
    id,
    inputMode: "numeric" as const,
    onBlur: commit,
    onFocus: () => setEditing(true),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commit();
    },
    onValueChange: setText,
    size: "sm" as const,
    value: text,
  };

  if (unit === undefined) return <Input className={CONTROL_W} {...field} />;

  return (
    <InputGroup className={CONTROL_W}>
      <InputGroupInput {...field} />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{unit}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

/* ---------------------------------------------------------------------------------- editor */

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

/* ----------------------------------------------------------------------------------- query */

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

/* ----------------------------------------------------------------------------------- files */

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

/* ------------------------------------------------------------------------------ appearance */

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
          <SelectTrigger className={CONTROL_W} size="sm">
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
