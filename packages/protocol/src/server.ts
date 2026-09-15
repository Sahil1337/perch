export type ServerInfo = {
  name: "perch";
  version: string;
  pid: number;
  url: string;
  startedAt: string;
  configDir: string;
  /**
   * `<configDir>/queries` — the folder perch made for itself. Where an untitled query goes when
   * no workspace folder is open, which is why the client is told about it rather than joining
   * paths itself: the separator is the server's business.
   */
  queriesDir: string;
};
