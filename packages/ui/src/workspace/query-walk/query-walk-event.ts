"use client";

export const QUERY_WALK_EVENT = "perch:visualise-query";

export type QueryWalkEventDetail = {
  /** The statement to walk, as the user wrote it. */
  sql: string;
};

/**
 * Opens the query walk from anywhere — the editor's context menu, the palette — without the caller
 * owning the dialog. `<QueryWalkDialog>` is mounted once in the shell and listens.
 */
export function requestQueryWalk(sql: string): void {
  window.dispatchEvent(new CustomEvent<QueryWalkEventDetail>(QUERY_WALK_EVENT, { detail: { sql } }));
}
