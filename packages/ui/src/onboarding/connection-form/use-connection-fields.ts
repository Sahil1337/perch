import type { Dialect } from "@perch/protocol";
import * as React from "react";
import type { ConnectionInput } from "../../workspace/types";
import { DIALECT_DEFAULTS } from "../dialect-mark";

/** Whether the address is given as a URL or as the individual fields. The server parses either. */
export type Mode = "fields" | "url";

export type ConnectionFields = {
  readonly dialect: Dialect;
  readonly name: string;
  readonly mode: Mode;
  readonly url: string;
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  setName: (value: string) => void;
  setMode: (value: Mode) => void;
  setUrl: (value: string) => void;
  setHost: (value: string) => void;
  setPort: (value: string) => void;
  setUser: (value: string) => void;
  setPassword: (value: string) => void;
  setDatabase: (value: string) => void;
  /** Picks a dialect and follows its defaults, then reports the choice upward. */
  chooseDialect: (next: Dialect) => void;
  /** Enough to submit: a name, and an address in whichever shape is showing. */
  readonly valid: boolean;
  buildInput: () => ConnectionInput;
};

export function useConnectionFields(
  initial: ConnectionInput | undefined,
  defaultDialect: Dialect,
  onDialectChange: ((dialect: Dialect) => void) | undefined,
): ConnectionFields {
  const [dialect, setDialect] = React.useState<Dialect>(initial?.dialect ?? defaultDialect);
  const [name, setName] = React.useState(initial?.name ?? "");
  const [mode, setMode] = React.useState<Mode>(
    initial?.url !== undefined && initial.host === undefined ? "url" : "fields",
  );
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [host, setHost] = React.useState(initial?.host ?? "localhost");
  const [port, setPort] = React.useState(String(initial?.port ?? DIALECT_DEFAULTS[dialect].port));
  const [user, setUser] = React.useState(initial?.user ?? "");
  const [password, setPassword] = React.useState("");
  const [database, setDatabase] = React.useState(
    initial?.database ?? DIALECT_DEFAULTS[dialect].database,
  );

  // Through a ref, so a parent rebuilding the callback each render cannot make the mount report
  // fire again.
  const report = React.useRef(onDialectChange);
  report.current = onDialectChange;

  // Once, for the first paint: the screen behind the form draws whichever dialect is pressed, and
  // at mount that is whatever `initial` or `defaultDialect` chose. Every later change reports from
  // `chooseDialect`, so clicking a card no longer costs a second render of this form.
  const mountDialect = React.useRef(dialect);
  React.useEffect(() => {
    report.current?.(mountDialect.current);
  }, []);

  const chooseDialect = React.useCallback(
    (next: Dialect) => {
      setDialect(next);
      // Only follow the dialect's defaults until the user overrides them: retyping 5432 over
      // someone's 5433 is the kind of helpfulness that loses work.
      setPort((current) =>
        current === String(DIALECT_DEFAULTS[dialect].port)
          ? String(DIALECT_DEFAULTS[next].port)
          : current,
      );
      setDatabase((current) =>
        current === DIALECT_DEFAULTS[dialect].database ? DIALECT_DEFAULTS[next].database : current,
      );
      report.current?.(next);
    },
    [dialect],
  );

  const valid =
    name.trim().length > 0 &&
    (mode === "url" ? url.trim().length > 0 : host.trim().length > 0 && database.trim().length > 0);

  const buildInput = React.useCallback((): ConnectionInput => {
    const base = { name: name.trim(), password: password.length > 0 ? password : undefined };
    if (mode === "url") return { ...base, url: url.trim() };
    return {
      ...base,
      dialect,
      host: host.trim(),
      port: Number(port) || DIALECT_DEFAULTS[dialect].port,
      user: user.trim(),
      database: database.trim(),
    };
  }, [database, dialect, host, mode, name, password, port, url, user]);

  return {
    dialect,
    name,
    mode,
    url,
    host,
    port,
    user,
    password,
    database,
    setName,
    setMode,
    setUrl,
    setHost,
    setPort,
    setUser,
    setPassword,
    setDatabase,
    chooseDialect,
    valid,
    buildInput,
  };
}
