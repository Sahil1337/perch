import type { Settings } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

export type SettingsApi = {
  get(opts?: CallOptions): Promise<Settings>;
  /** A patch: unknown and malformed fields are dropped, and the saved settings come back. */
  update(patch: Partial<Settings>, opts?: CallOptions): Promise<Settings>;
};

export function settingsApi(http: Transport): SettingsApi {
  return {
    get: (opts) => http.json<Settings>("/api/settings", { signal: opts?.signal }),
    update: (patch, opts) =>
      http.json<Settings>("/api/settings", { method: "PUT", body: patch, signal: opts?.signal }),
  };
}
