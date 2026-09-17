// A transient line under the editor, for when "Format document" could not do what was asked.
//
// Formatting is one of the few actions whose success and failure look identical: a statement the
// parser cannot read is returned exactly as typed, which is also what an already-formatted
// statement looks like. Without this the editor appears to have ignored the keystroke.

import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, type Panel, showPanel } from "@codemirror/view";

/** How long the notice stays up. Long enough to read twice, short enough not to need dismissing. */
const LINGER_MS = 6000;

const setNotice = StateEffect.define<string | null>();

const noticePanel = (message: string): Panel => {
  const dom = document.createElement("div");
  dom.className = "cm-format-notice";
  dom.textContent = message;
  // `top` defaults to false, so this sits under the editor.
  return { dom };
};

const noticeField = StateField.define<string | null>({
  create: () => null,
  update(message, tr) {
    for (const effect of tr.effects) if (effect.is(setNotice)) return effect.value;
    return message;
  },
  provide: (field) =>
    showPanel.from(field, (message) => (message === null ? null : () => noticePanel(message))),
});

const noticeTheme = EditorView.theme({
  ".cm-format-notice": {
    backgroundColor: "var(--color-muted)",
    borderTop: "1px solid var(--color-border)",
    color: "var(--color-muted-foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: "0.75rem",
    padding: "0.25rem 0.75rem",
  },
});

/** Add to an editor's extensions to let `showFormatNotice` work on it. */
export const formatNotice = [noticeField, noticeTheme];

/**
 * Timers per view, so a second format replaces the first one's notice instead of racing it into
 * an early dismissal.
 */
const timers = new WeakMap<EditorView, number>();

/** Shows `message` under `view` until it is replaced or `LINGER_MS` passes. */
export function showFormatNotice(view: EditorView, message: string): void {
  const existing = timers.get(view);
  if (existing !== undefined) window.clearTimeout(existing);

  view.dispatch({ effects: setNotice.of(message) });

  timers.set(
    view,
    window.setTimeout(() => {
      timers.delete(view);
      // The pane can close while the notice is up; a detached view rejects dispatches.
      if (view.dom.isConnected) view.dispatch({ effects: setNotice.of(null) });
    }, LINGER_MS),
  );
}
