// The one place that maps a dialect onto a concrete driver class.

import { type ConnectionConfig } from "@perch/protocol";
import { type Driver } from "./driver.js";
import { MysqlDriver } from "./mysql/driver.js";
import { PostgresDriver } from "./postgres/driver.js";

export function createDriver(config: ConnectionConfig): Driver {
  switch (config.dialect) {
    case "postgres":
      return new PostgresDriver(config);
    case "mysql":
      return new MysqlDriver(config);
    default: {
      const unknown: never = config.dialect;
      throw new Error(`unsupported dialect: ${String(unknown)}`);
    }
  }
}
