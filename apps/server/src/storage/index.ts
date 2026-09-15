// On-disk state under ~/.perch (PERCH_HOME overrides). One import site for the CLI and
// the server; the individual modules own one file each.

export { CONNECTIONS_FILE, HISTORY_FILE, SERVER_INFO_FILE, SETTINGS_FILE, configDir, configFile, defaultQueriesDir, ensureDir } from "./paths.js";
export { readJson, writeJsonAtomic } from "./json-file.js";
export {
  getConnection,
  listConnections,
  redactConnection,
  removeConnection,
  saveConnections,
  upsertConnection,
} from "./connections.js";
export { defaultSettings, ensureDefaultWorkspace, getSettings, saveSettings } from "./settings.js";
export { appendHistory, readHistory } from "./history.js";
export { clearServerInfo, readServerInfo, writeServerInfo } from "./server-info.js";
