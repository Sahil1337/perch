export const TRIGGERS_EVENT = "perch:show-triggers";

/** A table to open the view on. Both parts, because a name alone is ambiguous across schemas. */
export type TriggersFocus = { readonly schema: string; readonly table: string };

export type TriggersEventDetail = { focus?: TriggersFocus };

/**
 * Opens the Triggers view from anywhere — the schema toolbar, the palette — without the caller
 * owning the dialog. `<TriggersDialog>` is mounted once in the shell and listens.
 */
export function requestTriggers(focus?: TriggersFocus): void {
  window.dispatchEvent(new CustomEvent<TriggersEventDetail>(TRIGGERS_EVENT, { detail: { focus } }));
}

/**
 * The last request to open the view, as a store rather than as an event, for the reason the query
 * walk's opener gives: whether to be open and what to open on are one fact, and a store answers
 * both in one render.
 */
export type TriggersRequest = {
  readonly focus: TriggersFocus | null;
  /** A counter, so asking again for the same table after closing still reopens. */
  readonly nth: number;
};

let current: TriggersRequest | null = null;
let nth = 0;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener(TRIGGERS_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<TriggersEventDetail>).detail;
    nth += 1;
    current = { focus: detail?.focus ?? null, nth };
    for (const listener of listeners) listener();
  });
}

export function subscribeTriggers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const triggersRequest = (): TriggersRequest | null => current;

/** Nothing has been requested on the server, and nothing ever will be. */
export const noTriggersRequest = (): TriggersRequest | null => null;
