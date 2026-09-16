"use client";

// The one connection form, shared by onboarding and Settings → Connections: the same job, so the
// same component.
//
// Saving and testing are a single action. A connection written to disk but never dialled is a trap
// you find later, so the button saves, tests, and reports the round trip and the version that
// answered. A failed test still leaves the connection saved, which is why `onSaved` fires either
// way and the error sits next to the fields that caused it.

import type { ConnectionSummary, Dialect } from "@perch/protocol";
import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useCollapse, useFade, useSpring } from "../lib/motion";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Field, FieldDescription, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { useWorkspace } from "../workspace/context";
import type { ConnectionInput, ConnectionTest } from "../workspace/types";
import { DIALECT_DEFAULTS, DIALECT_LABEL, DialectMark } from "./dialect-mark";

const DIALECTS: readonly Dialect[] = ["postgres", "mysql"];

type Mode = "fields" | "url";

type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "testing" }
  | { kind: "ok"; test: ConnectionTest }
  | { kind: "error"; message: string };

export type ConnectionFormProps = {
  /** Set to edit an existing connection: writes through `updateConnection`. */
  connectionId?: string;
  /** Starting values — a discovered server, or the connection being edited. */
  initial?: ConnectionInput;
  /** Fires once the connection is saved. `test` is null when the round trip failed. */
  onSaved?: (connection: ConnectionSummary, test: ConnectionTest | null) => void;
  /** Renders a Cancel button beside the submit. Settings uses it; onboarding does not. */
  onCancel?: () => void;
  /** Overrides the submit label. Onboarding says "Connect", where it also opens the connection. */
  submitLabel?: string;
  /**
   * Rendered opposite the submit button. Onboarding's "Skip for now" lives here while the form is
   * open: that row is then the bottom of the screen, and the way out of a screen goes in its corner.
   */
  trailing?: React.ReactNode;
  /**
   * The selected dialect, reported on mount and on every change: the first-run screen draws what is
   * being connected to, and while the form is open that is whichever card is pressed.
   */
  onDialectChange?: (dialect: Dialect) => void;
  /** Which card starts pressed without an `initial`, so a MySQL-only machine does not open on Postgres. */
  defaultDialect?: Dialect;
  className?: string;
};

export function ConnectionForm({
  connectionId,
  initial,
  onSaved,
  onCancel,
  submitLabel,
  trailing,
  onDialectChange,
  defaultDialect = "postgres",
  className,
}: ConnectionFormProps): React.ReactElement {
  const { addConnection, updateConnection, testConnection } = useWorkspace();
  const spring = useSpring();
  const collapse = useCollapse();
  const fade = useFade();

  const [dialect, setDialect] = React.useState<Dialect>(initial?.dialect ?? defaultDialect);
  const [name, setName] = React.useState(initial?.name ?? "");
  const [mode, setMode] = React.useState<Mode>(initial?.url !== undefined && initial.host === undefined ? "url" : "fields");
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [host, setHost] = React.useState(initial?.host ?? "localhost");
  const [port, setPort] = React.useState(String(initial?.port ?? DIALECT_DEFAULTS[dialect].port));
  const [user, setUser] = React.useState(initial?.user ?? "");
  const [password, setPassword] = React.useState("");
  const [database, setDatabase] = React.useState(initial?.database ?? DIALECT_DEFAULTS[dialect].database);

  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  // The id of the row this form has already created, so a second attempt edits it instead of
  // adding a duplicate every time the password was wrong.
  const [savedId, setSavedId] = React.useState<string | undefined>(connectionId);

  const busy = phase.kind === "saving" || phase.kind === "testing";

  // Through a ref, so a parent rebuilding the callback each render cannot cause a loop.
  const report = React.useRef(onDialectChange);
  report.current = onDialectChange;
  React.useEffect(() => {
    report.current?.(dialect);
  }, [dialect]);

  function chooseDialect(next: Dialect): void {
    setDialect(next);
    // Only follow the dialect's defaults until the user overrides them: retyping 5432 over
    // someone's 5433 is the kind of helpfulness that loses work.
    if (port === String(DIALECT_DEFAULTS[dialect].port)) setPort(String(DIALECT_DEFAULTS[next].port));
    if (database === DIALECT_DEFAULTS[dialect].database) setDatabase(DIALECT_DEFAULTS[next].database);
  }

  const valid =
    name.trim().length > 0 &&
    (mode === "url" ? url.trim().length > 0 : host.trim().length > 0 && database.trim().length > 0);

  function buildInput(): ConnectionInput {
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
  }

  async function submit(): Promise<void> {
    if (!valid || busy) return;
    setPhase({ kind: "saving" });
    let saved: ConnectionSummary;
    try {
      const input = buildInput();
      saved = savedId === undefined ? await addConnection(input) : await updateConnection(savedId, input);
      setSavedId(saved.id);
    } catch (cause) {
      setPhase({ kind: "error", message: messageOf(cause) });
      return;
    }

    setPhase({ kind: "testing" });
    try {
      const test = await testConnection(saved.id);
      setPhase({ kind: "ok", test });
      onSaved?.(saved, test);
    } catch (cause) {
      setPhase({ kind: "error", message: messageOf(cause) });
      onSaved?.(saved, null);
    }
  }

  return (
    <form
      className={cn("flex flex-col gap-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">Server</legend>
        <div className="grid grid-cols-2 gap-2">
          {DIALECTS.map((option) => (
            <button
              aria-pressed={dialect === option}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                dialect === option
                  ? "border-primary bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent/50",
              )}
              key={option}
              onClick={() => chooseDialect(option)}
              type="button"
            >
              <DialectMark dialect={option} />
              {DIALECT_LABEL[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input
          autoComplete="off"
          onValueChange={setName}
          placeholder={`${dialect}-local`}
          value={name}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm">Address</span>
          <Button
            onClick={() => setMode(mode === "url" ? "fields" : "url")}
            size="xs"
            variant="ghost"
          >
            {mode === "url" ? "Use fields" : "Use URL"}
          </Button>
        </div>

        {/* The two shapes are the same information, so they swap in place and the panel takes
            the height of whichever is showing rather than jumping to the taller one. */}
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key={mode}
            transition={collapse}
          >
            {mode === "url" ? (
              <Field>
                <FieldLabel>Connection URL</FieldLabel>
                <Input
                  autoComplete="off"
                  onValueChange={setUrl}
                  placeholder={`${dialect}://user@localhost:${DIALECT_DEFAULTS[dialect].port}/${DIALECT_DEFAULTS[dialect].database}`}
                  spellCheck={false}
                  value={url}
                />
                <FieldDescription>The server parses this into the fields below.</FieldDescription>
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Host</FieldLabel>
                  <Input autoComplete="off" onValueChange={setHost} spellCheck={false} value={host} />
                </Field>
                <Field>
                  <FieldLabel>Port</FieldLabel>
                  <Input inputMode="numeric" onValueChange={setPort} value={port} />
                </Field>
                <Field>
                  <FieldLabel>User</FieldLabel>
                  <Input autoComplete="off" onValueChange={setUser} spellCheck={false} value={user} />
                </Field>
                <Field>
                  <FieldLabel>Database</FieldLabel>
                  <Input
                    autoComplete="off"
                    onValueChange={setDatabase}
                    spellCheck={false}
                    value={database}
                  />
                </Field>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <Field>
        <FieldLabel>Password</FieldLabel>
        <Input
          autoComplete="off"
          onValueChange={setPassword}
          placeholder={connectionId === undefined ? "" : "Unchanged"}
          type="password"
          value={password}
        />
        <FieldDescription>Stored in the server&apos;s config file, readable only by you.</FieldDescription>
      </Field>

      <div className="flex min-h-8 items-center gap-2">
        <Button disabled={!valid} loading={busy} render={<button type="submit" />} variant="outline">
          {phase.kind === "testing"
            ? "Testing…"
            : (submitLabel ?? (connectionId === undefined ? "Test" : "Save & test"))}
        </Button>
        {onCancel !== undefined && (
          <Button onClick={onCancel} size="default" variant="ghost">
            Cancel
          </Button>
        )}

        <AnimatePresence initial={false} mode="wait">
          {phase.kind === "ok" && (
            <motion.p
              animate={{ opacity: 1 }}
              className="ml-auto flex min-w-0 items-center gap-1.5 text-success-foreground text-xs"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="ok"
              transition={fade}
            >
              <motion.span
                animate={{ scale: 1 }}
                className="flex"
                initial={{ scale: 0.4 }}
                transition={spring}
              >
                <CheckIcon className="size-3.5" />
              </motion.span>
              <span className="truncate tabular-nums">
                {Math.round(phase.test.latencyMs)} ms · {phase.test.serverVersion}
              </span>
            </motion.p>
          )}
        </AnimatePresence>

        {trailing !== undefined && <div className="ml-auto flex items-center">{trailing}</div>}
      </div>

      <AnimatePresence initial={false}>
        {phase.kind === "error" && (
          <motion.p
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden text-destructive-foreground text-xs"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            role="alert"
            transition={spring}
          >
            {phase.message}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : "The connection could not be reached.";
}
