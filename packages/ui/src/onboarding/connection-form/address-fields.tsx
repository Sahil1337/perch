"use client";

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useCollapse } from "../../lib/motion";
import { Button } from "../../ui/button";
import { Field, FieldDescription, FieldLabel } from "../../ui/field";
import { Input } from "../../ui/input";
import { DIALECT_DEFAULTS } from "../dialect-mark";
import type { ConnectionFields } from "./use-connection-fields";

/** Where the server is, in whichever of the two shapes is showing. */
export function AddressFields({ fields }: { fields: ConnectionFields }): React.ReactElement {
  const collapse = useCollapse();
  const { dialect, mode, setMode } = fields;

  return (
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
                onValueChange={fields.setUrl}
                placeholder={`${dialect}://user@localhost:${DIALECT_DEFAULTS[dialect].port}/${DIALECT_DEFAULTS[dialect].database}`}
                spellCheck={false}
                value={fields.url}
              />
              <FieldDescription>The server parses this into the fields below.</FieldDescription>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Host</FieldLabel>
                <Input
                  autoComplete="off"
                  onValueChange={fields.setHost}
                  spellCheck={false}
                  value={fields.host}
                />
              </Field>
              <Field>
                <FieldLabel>Port</FieldLabel>
                <Input inputMode="numeric" onValueChange={fields.setPort} value={fields.port} />
              </Field>
              <Field>
                <FieldLabel>User</FieldLabel>
                <Input
                  autoComplete="off"
                  onValueChange={fields.setUser}
                  spellCheck={false}
                  value={fields.user}
                />
              </Field>
              <Field>
                <FieldLabel>Database</FieldLabel>
                <Input
                  autoComplete="off"
                  onValueChange={fields.setDatabase}
                  spellCheck={false}
                  value={fields.database}
                />
              </Field>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
