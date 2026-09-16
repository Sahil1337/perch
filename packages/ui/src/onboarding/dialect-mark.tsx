// A drawn mark for a dialect, not a logo.
//
// Shipping the Postgres elephant or the MySQL dolphin means shipping someone else's trademark
// into a product that is not theirs, so these are ordinary drawings that say "a database" and
// differ enough to be told apart at 16px: Postgres gets the stacked drum, MySQL the sharded
// one. The name always sits next to the mark — the shape is recognition, never identification.

import type { Dialect } from "@perch/protocol";
import type React from "react";
import { cn } from "../lib/utils";

export function DialectMark({
  dialect,
  className,
}: {
  dialect: Dialect;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      aria-hidden
      className={cn("size-4 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {dialect === "postgres" ? (
        <>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
          <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
        </>
      ) : (
        <>
          <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
          <path d="M5 5.5v13c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-13" />
          <path d="M12 8v13" />
        </>
      )}
    </svg>
  );
}

/** The label a dialect goes by in the UI. */
export const DIALECT_LABEL: Record<Dialect, string> = {
  postgres: "Postgres",
  mysql: "MySQL",
};

export const DIALECT_DEFAULTS: Record<Dialect, { port: number; database: string }> = {
  postgres: { port: 5432, database: "postgres" },
  mysql: { port: 3306, database: "mysql" },
};
