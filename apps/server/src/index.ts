// The package as a library. Nothing in the monorepo depends on `perch` (frontends talk to it
// over HTTP through @perch/client), so this barrel exists for embedders and for `perch`'s own
// integration surface: build a server, drive a driver, read the config store.

export { VERSION } from "./core/version.js";
export { splitStatements, type SplitStatement } from "./core/sql/split.js";

export { createDriver, defaultPort, parseConnectionUrl, type Driver } from "./db/index.js";
export {
  BaseDriver,
  normalizeRunOptions,
  type RunOptions,
  type StatementContext,
} from "./db/base-driver.js";
export { StatementSink } from "./db/statement-sink.js";
export { MysqlDriver } from "./db/mysql/driver.js";
export { PostgresDriver } from "./db/postgres/driver.js";

export {
  appendHistory,
  clearServerInfo,
  configDir,
  defaultSettings,
  getConnection,
  getSettings,
  listConnections,
  readHistory,
  readServerInfo,
  redactConnection,
  removeConnection,
  saveConnections,
  saveSettings,
  upsertConnection,
  writeServerInfo,
} from "./storage/index.js";

export {
  createApp,
  createServer,
  type CreateAppOptions,
  type RouteDeps,
  type ServerHandle,
} from "./server/create-server.js";
export {
  DEFAULT_PORT,
  DEFAULT_HOST,
  PORT_SCAN,
  startServer,
  type RunningServer,
  type StartServerOptions,
} from "./server/start.js";
export { toCsv, csvCell, csvRow, type CsvOptions } from "./server/http/csv.js";
export {
  HttpError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  type ApiError,
} from "./server/http/errors.js";
export { ConnectionPool, type ConnectionPoolOptions } from "./server/services/connection-pool.js";
export { RunLog, stripRows } from "./server/services/run-log.js";
export {
  QueryRunner,
  type RunFinishedListener,
  type StartRunInput,
} from "./server/services/query-runner.js";
export {
  createServices,
  type ServerServices,
  type ServicesOptions,
} from "./server/services/create-services.js";
export { EventBus } from "./server/services/event-bus.js";
export { FileWatcher } from "./server/services/watcher.js";
export { SchemaCache } from "./server/services/schema-cache.js";
export {
  DiscoveryService,
  discoverServers,
  DISCOVERY_TTL_MS,
} from "./server/services/discovery/index.js";
