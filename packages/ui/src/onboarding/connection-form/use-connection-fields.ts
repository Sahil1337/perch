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
  readonly ssl: boolean;
  setName: (value: string) => void;
  setMode: (value: Mode) => void;
  setUrl: (value: string) => void;
  setHost: (value: string) => void;
  setPort: (value: string) => void;
  setUser: (value: string) => void;
  setPassword: (value: string) => void;
  setDatabase: (value: string) => void;
  setSSL: (value: boolean) => void;
  /** Picks a dialect and follows its defaults, then reports the choice upward. */
  chooseDialect: (next: Dialect) => void;
  /** Enough to submit: a name, and an address in whichever shape is showing. */
  readonly valid: boolean;
  buildInput: () => ConnectionInput;
};

/** Anything that is not this machine. Hosted Postgres — Neon, Supabase, RDS — is all of it. */
function isRemote(host: string): boolean {
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);
  return !local.has(host.trim().toLowerCase());
}

/** What a pasted URL asks for, so the switch reflects it rather than contradicting it. */
function urlWantsTLS(raw: string): boolean {
  const match = /[?&]sslmode=([^&]+)/i.exec(raw);
  if (match) return !/^(disable|allow)$/i.test(decodeURIComponent(match[1] ?? ""));
  if (/[?&]ssl=(0|false)/i.test(raw)) return false;
  if (/[?&]ssl=/i.test(raw)) return true;
  try {
    return isRemote(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/**
 * A name for a pasted URL. Hosted providers hand out a host that already identifies the database
 * — `ep-cool-darkness-12345.eu-central-1.aws.neon.tech` — so its first label beats anything
 * generated, and beats making the user invent one before the form will submit.
 */
function nameFromUrl(raw: string): string {
  try {
    const host = new URL(raw.trim()).hostname.replace(/^\[|\]$/g, "");
    const label = host.split(".")[0] ?? "";
    return label === "" || /^\d+$/.test(label) ? "database" : label;
  } catch {
    return "database";
  }
}

export function useConnectionFields(
  initial: ConnectionInput | undefined,
  defaultDialect: Dialect,
  onDialectChange: ((dialect: Dialect) => void) | undefined,
  defaultMode?: Mode,
): ConnectionFields {
  const [dialect, setDialect] = React.useState<Dialect>(initial?.dialect ?? defaultDialect);
  const [name, setName] = React.useState(initial?.name ?? "");
  const [mode, setMode] = React.useState<Mode>(
    defaultMode ?? (initial?.url !== undefined && initial.host === undefined ? "url" : "fields"),
  );
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [host, setHost] = React.useState(initial?.host ?? "localhost");
  const [port, setPort] = React.useState(String(initial?.port ?? DIALECT_DEFAULTS[dialect].port));
  const [user, setUser] = React.useState(initial?.user ?? "");
  const [password, setPassword] = React.useState("");
  const [database, setDatabase] = React.useState(
    initial?.database ?? DIALECT_DEFAULTS[dialect].database,
  );
  // Whether the user has taken the switch over. Until they do it follows the host, because the
  // answer is not a preference: a hosted database requires TLS and a local one does not offer it.
  const [sslChoice, setSSLChoice] = React.useState<boolean | null>(initial?.ssl ?? null);

  // Through a ref, so a parent rebuilding the callback each render cannot make the mount report
  // fire again. Written after the commit, so a render React throws away cannot leave the latest
  // callback behind; declared above the mount report, which is what makes it the fresher of the two.
  const report = React.useRef(onDialectChange);
  React.useEffect(() => {
    report.current = onDialectChange;
  });

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

  const ssl = sslChoice ?? (mode === "url" ? urlWantsTLS(url) : isRemote(host));

  // A pasted URL names the server itself, so the name is not a second thing to think of before
  // the button turns on: an empty one is filled in from the host.
  const valid =
    mode === "url"
      ? url.trim().length > 0
      : name.trim().length > 0 && host.trim().length > 0 && database.trim().length > 0;

  const buildInput = React.useCallback((): ConnectionInput => {
    const base = { name: name.trim(), password: password.length > 0 ? password : undefined };
    // A URL says what it wants in its own query string, and the server reads it there. Sending the
    // switch's value alongside would overwrite a `sslmode=verify-full` with a bare "on".
    if (mode === "url") {
      return { ...base, name: base.name === "" ? nameFromUrl(url) : base.name, url: url.trim() };
    }
    return {
      ...base,
      dialect,
      host: host.trim(),
      port: Number(port) || DIALECT_DEFAULTS[dialect].port,
      user: user.trim(),
      database: database.trim(),
      ssl,
    };
  }, [database, dialect, host, mode, name, password, port, ssl, url, user]);

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
    ssl,
    setName,
    setMode,
    setUrl,
    setHost,
    setPort,
    setUser,
    setPassword,
    setDatabase,
    setSSL: setSSLChoice,
    chooseDialect,
    valid,
    buildInput,
  };
}
