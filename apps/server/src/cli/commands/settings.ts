// `perch settings get [key] | perch settings set <key> <value>`

import type { Settings } from "@perch/protocol";
import { defaultSettings, getSettings, saveSettings } from "../../storage/index.js";
import { defineCommand, defineGroup, die, printJson } from "../util/index.js";

const SETTINGS_HELP =
  "usage: perch settings get [key] [--json]\n       perch settings set <key> <value>";

function isSettingsKey(key: string): key is keyof Settings {
  return Object.hasOwn(defaultSettings, key);
}

function parseSettingValue(key: keyof Settings, raw: string): unknown {
  const current = defaultSettings[key];
  if (typeof current === "boolean") return raw === "true" || raw === "1";
  if (typeof current === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) die(`"${key}" expects a number, got "${raw}"`);
    return n;
  }
  if (Array.isArray(current)) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (key === "theme" && raw !== "dark" && raw !== "light") {
    die('"theme" must be one of dark|light');
  }
  return raw;
}

const get = defineCommand({ usage: SETTINGS_HELP }, async ({ positionals, json }) => {
  const settings = await getSettings();
  const key = positionals[0];
  if (key) {
    if (!isSettingsKey(key)) die(`unknown setting: ${key}`);
    console.log(json ? JSON.stringify(settings[key]) : String(settings[key]));
    return;
  }
  printJson(settings);
});

const set = defineCommand(
  { usage: SETTINGS_HELP, positionals: ["key", "value"] },
  async ({ positionals }) => {
    const [key, value] = positionals as [string, string];
    if (!isSettingsKey(key)) die(`unknown setting: ${key}`);
    const next = await saveSettings({ [key]: parseSettingValue(key, value) } as Partial<Settings>);
    console.log(`${key} = ${JSON.stringify(next[key])}`);
  },
);

export const cmdSettings = defineGroup(SETTINGS_HELP, { get, set });
