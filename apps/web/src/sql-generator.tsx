// Experimental: backs the topbar's generate button with `claude -p` on the server.

import { Spinner, generateInLastEditor, setSqlGenerator, useSqlGenerating, useWorkspace } from "@perch/ui";
import { ZapIcon } from "lucide-react";
import * as React from "react";
import type { DatabaseSchema } from "@perch/protocol";
import { serverBaseUrl } from "@/lib/server-client";

function describeSchema(db: DatabaseSchema): string {
  const out = [`database: ${db.database}`];
  for (const s of db.schemas) {
    for (const t of s.tables) {
      const rows = t.rowEstimate === undefined ? "" : `, ~${t.rowEstimate} rows`;
      out.push(`${s.name}.${t.name} (${t.kind}${rows})`);
      for (const c of t.columns) {
        const flags = [c.pk && "PK", !c.nullable && "NOT NULL", c.default !== null && `DEFAULT ${c.default}`]
          .filter(Boolean)
          .join(" ");
        out.push(`  ${c.name} ${c.type}${flags ? ` ${flags}` : ""}`);
      }
      for (const fk of t.foreignKeys) {
        out.push(`  FK (${fk.columns.join(", ")}) -> ${fk.refSchema}.${fk.refTable}(${fk.refColumns.join(", ")})`);
      }
    }
  }
  return out.join("\n");
}

export function SqlGenerator(): null {
  const { schema, connection } = useWorkspace();
  const dialect = connection?.dialect ?? "postgres";
  const schemaText = schema.status === "ready" ? describeSchema(schema.data) : "";

  React.useEffect(() => {
    setSqlGenerator(async (prompt, file) => {
      const res = await fetch(`${serverBaseUrl()}/api/generate`, {
        body: JSON.stringify({ dialect, file, prompt, schema: schemaText }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await res.json()) as { sql?: string; error?: { message: string } };
      if (!res.ok || !json.sql) throw new Error(json.error?.message ?? "no sql returned");
      return json.sql;
    });
    return () => setSqlGenerator(null);
  }, [dialect, schemaText]);

  return null;
}

/** Generates from the prompt under the cursor in the last-focused editor. */
export function GenerateButton(): React.ReactElement {
  const generating = useSqlGenerating();
  return (
    <button
      aria-label="Generate SQL"
      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={generateInLastEditor}
      // Keeps the editor focused, so its cursor stays where the prompt is.
      onMouseDown={(event) => event.preventDefault()}
      title="Generate SQL from the block under the cursor"
      type="button"
    >
      {generating ? <Spinner className="size-4" /> : <ZapIcon className="size-4" />}
    </button>
  );
}
