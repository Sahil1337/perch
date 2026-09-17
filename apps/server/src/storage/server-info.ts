// server.json — how `perch status` / `perch stop` find a running instance. 0600, like the other
// files here: nothing else needs to read where this machine's server is listening.

import { type ServerInfo } from "@perch/protocol";
import { SERVER_INFO_FILE } from "./paths.js";
import { JsonStore } from "./json-file.js";

const store = new JsonStore<ServerInfo | undefined>(SERVER_INFO_FILE, () => undefined, 0o600);

export const writeServerInfo = (info: ServerInfo): Promise<void> => store.write(info);

export const readServerInfo = (): Promise<ServerInfo | undefined> => store.read();

export const clearServerInfo = (): Promise<void> => store.remove();
