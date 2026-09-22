// The one connection form, shared by onboarding and Settings → Connections: the same job, so the
// same component.
//
// Saving and testing are a single action. A connection written to disk but never dialled is a trap
// you find later, so the button saves, tests, and reports the round trip and the version that
// answered. A failed test still leaves the connection saved, which is why `onSaved` fires either
// way and the error sits next to the fields that caused it.
//
// This file owns the submit; the fields are in `use-connection-fields.ts` and the three groups of
// markup are their own components.

import type { ConnectionSummary, Dialect } from "@perch/protocol";
import * as React from "react";
import { messageOf } from "../../lib/errors";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Field, FieldDescription, FieldLabel } from "../../ui/field";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { useWorkspace } from "../../workspace/context";
import type { ConnectionInput, ConnectionTest } from "../../workspace/types";
import { AddressFields } from "./address-fields";
import { DialectPicker } from "./dialect-picker";
import { TestError, TestOk, type Phase } from "./form-status";
import { useConnectionFields, type Mode } from "./use-connection-fields";

/** Shown when a rejection carries no readable message: this form only ever fails at the wire. */
const UNREACHABLE = "The connection could not be reached.";

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
  /** Which half of the address the form opens on. "Paste a connection URL" starts on the URL. */
  defaultMode?: Mode;
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
  defaultMode,
  className,
}: ConnectionFormProps): React.ReactElement {
  const { addConnection, updateConnection, testConnection } = useWorkspace();
  const fields = useConnectionFields(initial, defaultDialect, onDialectChange, defaultMode);

  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  // The id of the row this form has already created, so a second attempt edits it instead of
  // adding a duplicate every time the password was wrong.
  const [savedId, setSavedId] = React.useState<string | undefined>(connectionId);

  const busy = phase.kind === "saving" || phase.kind === "testing";

  async function submit(): Promise<void> {
    if (!fields.valid || busy) return;
    setPhase({ kind: "saving" });
    let saved: ConnectionSummary;
    try {
      const input = fields.buildInput();
      saved =
        savedId === undefined ? await addConnection(input) : await updateConnection(savedId, input);
      setSavedId(saved.id);
    } catch (cause) {
      setPhase({ kind: "error", message: messageOf(cause, UNREACHABLE) });
      return;
    }

    setPhase({ kind: "testing" });
    try {
      const test = await testConnection(saved.id);
      setPhase({ kind: "ok", test });
      onSaved?.(saved, test);
    } catch (cause) {
      setPhase({ kind: "error", message: messageOf(cause, UNREACHABLE) });
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
      <DialectPicker onChange={fields.chooseDialect} value={fields.dialect} />

      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input
          autoComplete="off"
          onValueChange={fields.setName}
          placeholder={`${fields.dialect}-local`}
          value={fields.name}
        />
      </Field>

      <AddressFields fields={fields} />

      {/* One line, and on the same grid as the Address header above it: label left, control right.
          Only in fields mode — a URL carries its own sslmode, and a switch beside it would be a
          second answer to a question already answered. It follows the host until touched, because
          hosted Postgres requires TLS and a server on this machine does not offer it, and the
          alternative is a first run that fails on a setting nobody knew to look for. */}
      {fields.mode === "fields" && (
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="connection-ssl">
              Connect over TLS
              <span className="font-normal text-muted-foreground">
                — required by hosted databases
              </span>
            </FieldLabel>
            <Switch checked={fields.ssl} id="connection-ssl" onCheckedChange={fields.setSSL} />
          </div>
        </Field>
      )}

      <Field>
        <FieldLabel>Password</FieldLabel>
        <Input
          autoComplete="off"
          onValueChange={fields.setPassword}
          placeholder={connectionId === undefined ? "" : "Unchanged"}
          type="password"
          value={fields.password}
        />
        <FieldDescription>
          Stored in the server&apos;s config file, readable only by you.
        </FieldDescription>
      </Field>

      <div className="flex min-h-8 items-center gap-2">
        <Button
          disabled={!fields.valid}
          loading={busy}
          render={<button type="submit" />}
          variant="outline"
        >
          {phase.kind === "testing"
            ? "Testing…"
            : (submitLabel ?? (connectionId === undefined ? "Test" : "Save & test"))}
        </Button>
        {onCancel !== undefined && (
          <Button onClick={onCancel} size="default" variant="ghost">
            Cancel
          </Button>
        )}

        <TestOk phase={phase} />

        {trailing !== undefined && <div className="ml-auto flex items-center">{trailing}</div>}
      </div>

      <TestError phase={phase} />
    </form>
  );
}
