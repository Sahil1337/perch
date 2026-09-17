// `perch conn add|ls|rm|test|dbs`

import { defaultPort, parseConnectionUrl } from "../../db/index.js";
import {
  listConnections,
  redactConnection,
  removeConnection,
  upsertConnection,
} from "../../storage/index.js";
import type { ConnectionConfig, Dialect } from "@perch/protocol";
import {
  bold,
  defineCommand,
  defineGroup,
  die,
  dim,
  printJson,
  readStdinLine,
  requireConnection,
  withDriver,
} from "../util/index.js";

const CONN_HELP = `usage: perch conn add <name> <url> [--test]
       perch conn add <name> --dialect <postgres|mysql> --host <h> --user <u> --database <db>
                     [--port <n>] [--password <p> | --password-stdin] [--ssl] [--test]
       perch conn ls [--json]
       perch conn rm <name>
       perch conn test <name> [--json]
       perch conn dbs <name> [--json]

<url> examples: postgres://user:pass@host:5432/db?sslmode=require, mysql://user:pass@host:3306/db
`;

async function testAndPrint(conn: ConnectionConfig, asJson: boolean): Promise<void> {
  const result = await withDriver(conn, (d) => d.test());
  if (asJson) printJson(result);
  else console.log(`ok · ${result.serverVersion} · ${result.latencyMs} ms`);
}

const add = defineCommand(
  {
    usage: CONN_HELP,
    positionals: ["name"],
    options: {
      dialect: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      user: { type: "string" },
      password: { type: "string" },
      "password-stdin": { type: "boolean" },
      database: { type: "string" },
      ssl: { type: "boolean" },
      test: { type: "boolean" },
    },
  },
  async ({ values, positionals, json }) => {
    const [name, url] = positionals as [string, string | undefined];

    let base: Omit<ConnectionConfig, "id" | "name" | "createdAt">;
    if (url) {
      base = parseConnectionUrl(url);
    } else {
      const dialect = values.dialect as Dialect | undefined;
      if (dialect !== "postgres" && dialect !== "mysql")
        die('--dialect must be "postgres" or "mysql"');
      if (!values.host || !values.user || !values.database) {
        die("missing required flags: --host --user --database");
      }
      const password = values["password-stdin"] ? await readStdinLine() : values.password;
      base = {
        dialect,
        host: values.host,
        port: values.port ? Number(values.port) : defaultPort(dialect),
        user: values.user,
        password,
        database: values.database,
        ssl: values.ssl ?? false,
      };
    }

    const conn = await upsertConnection({ ...base, name });
    if (json) printJson(redactConnection(conn));
    else
      console.log(
        `added "${bold(conn.name)}" — ${conn.dialect}://${conn.host}:${conn.port}/${conn.database}`,
      );

    if (values.test) await testAndPrint(conn, json);
  },
);

const ls = defineCommand({ usage: "usage: perch conn ls [--json]" }, async ({ json }) => {
  const list = await listConnections();
  if (json) {
    printJson(list.map(redactConnection));
    return;
  }
  if (list.length === 0) {
    console.log('no connections yet — add one with "perch conn add <name> <url>"');
    return;
  }
  for (const c of list) {
    console.log(
      `${bold(c.name)}  ${c.dialect}  ${c.user}@${c.host}:${c.port}/${c.database}${c.ssl ? " (ssl)" : ""}`,
    );
  }
});

const rm = defineCommand(
  { usage: "usage: perch conn rm <name>", positionals: ["name"] },
  async ({ positionals }) => {
    const name = positionals[0]!;
    if (!(await removeConnection(name))) die(`no connection named "${name}"`);
    console.log(`removed "${name}"`);
  },
);

const test = defineCommand(
  { usage: "usage: perch conn test <name> [--json]", positionals: ["name"] },
  async ({ positionals, json }) => {
    await testAndPrint(await requireConnection(positionals[0]!), json);
  },
);

const dbs = defineCommand(
  { usage: "usage: perch conn dbs <name> [--json]", positionals: ["name"] },
  async ({ positionals, json }) => {
    const conn = await requireConnection(positionals[0]!);
    const list = await withDriver(conn, (d) => d.listDatabases());
    if (json) printJson(list);
    else if (list.length === 0) console.log(dim("(no databases)"));
    else list.forEach((d) => console.log(d));
  },
);

export const cmdConn = defineGroup(CONN_HELP, { add, ls, rm, test, dbs });
