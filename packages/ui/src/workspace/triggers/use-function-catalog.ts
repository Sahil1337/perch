import type { TriggerFunctionRef } from "@perch/protocol";
import * as React from "react";
import { useWorkspace } from "../context";
import { asyncData } from "../types";
import {
  functionCatalogSql,
  readFunctionCatalog,
  type FunctionCatalogResult,
} from "./trigger-catalog";

export type FunctionCatalogState = { readonly status: "loading" } | FunctionCatalogResult;

type Read = { readonly ref: string; readonly result: FunctionCatalogResult };

/**
 * One trigger function as the catalog has it, read when something shows it. Read again whenever
 * the schema is, since the change that refreshed it may have been to this function; the last read
 * of the same function stays on screen meanwhile, so a refresh never flashes a loading state over
 * a body that is about to come back the same. Null when there is no function to read.
 */
export function useFunctionCatalog(ref: TriggerFunctionRef | null): FunctionCatalogState | null {
  const { probe, schema } = useWorkspace();
  const fetchedAt = asyncData(schema)?.fetchedAt ?? null;
  const refKey = ref ? JSON.stringify([ref.schema, ref.name]) : null;
  const [read, setRead] = React.useState<Read | null>(null);

  React.useEffect(() => {
    if (refKey === null) return;
    const [schemaName, name] = JSON.parse(refKey) as [string, string];
    const target: TriggerFunctionRef = { schema: schemaName, name };
    let live = true;
    probe(functionCatalogSql(target)).then(
      (record) => {
        if (live) setRead({ ref: refKey, result: readFunctionCatalog(target, record) });
      },
      (error: unknown) => {
        if (!live) return;
        const message = error instanceof Error ? error.message : String(error);
        setRead({ ref: refKey, result: { status: "error", message } });
      },
    );
    return () => {
      live = false;
    };
  }, [fetchedAt, probe, refKey]);

  if (refKey === null) return null;
  return read && read.ref === refKey ? read.result : { status: "loading" };
}
