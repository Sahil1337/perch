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
  window.dispatchEvent(
    new CustomEvent<QueryWalkEventDetail>(QUERY_WALK_EVENT, { detail: { sql } }),
  );
}

/**
 * The last statement anyone asked to walk, as a store rather than as an event.
 *
 * The dialog needs two things from this — whether to be open, and what to show — and reading them
 * off an event listener meant two `useState`s written from inside an effect, which is two renders
 * for one request and two names for one fact. A store answers both at once: a request is a new
 * snapshot, and "no request yet" is null.
 */
export type QueryWalkRequest = {
  readonly sql: string;
  /** A counter, not a clock: two requests in the same millisecond are still two requests. */
  readonly nth: number;
};

let current: QueryWalkRequest | null = null;
let nth = 0;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener(QUERY_WALK_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<QueryWalkEventDetail>).detail;
    if (!detail?.sql.trim()) return;
    // Numbered rather than identified by its SQL, so asking for the SAME statement twice is still
    // two requests: a reader who closed the dialog and hit the shortcut again means it to reopen.
    nth += 1;
    current = { sql: detail.sql, nth };
    for (const listener of listeners) listener();
  });
}

export function subscribeQueryWalk(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const queryWalkRequest = (): QueryWalkRequest | null => current;

/** Nothing has been requested on the server, and nothing ever will be. */
export const noQueryWalkRequest = (): QueryWalkRequest | null => null;
