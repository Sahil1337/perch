// Experimental: the topbar's generate button. The app registers the function that
// talks to the server; the editor only finds the prompt and writes the answer back.

import type { EditorView } from "@codemirror/view";
import * as React from "react";

/** `file` is the whole editor document, so the model can match how the file is written. */
type SqlGenerator = (prompt: string, file: string) => Promise<string>;

let generator: SqlGenerator | null = null;

export function setSqlGenerator(fn: SqlGenerator | null): void {
  generator = fn;
}

let lastView: EditorView | null = null;

/** Remembers the editor the user was last in, so a button outside it knows where to write. */
export function trackEditorView(view: EditorView): () => void {
  lastView ??= view;
  const onFocus = (): void => {
    lastView = view;
  };
  view.contentDOM.addEventListener("focus", onFocus);
  return () => {
    view.contentDOM.removeEventListener("focus", onFocus);
    if (lastView === view) lastView = null;
  };
}

/** Generates into the last-focused editor. */
export function generateInLastEditor(): void {
  if (lastView) generateIntoView(lastView);
}

let pending = 0;
const listeners = new Set<() => void>();

function setPending(delta: number): void {
  pending += delta;
  for (const l of listeners) l();
}

/** True while any generation is in flight. */
export function useSqlGenerating(): boolean {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending > 0,
  );
}

/** The selection, or the run of non-blank lines around the cursor, becomes the prompt. */
export function generateIntoView(view: EditorView): void {
  if (!generator) return;
  const { doc } = view.state;
  const sel = view.state.selection.main;

  let from: number;
  let to: number;
  if (sel.from !== sel.to) {
    from = doc.lineAt(sel.from).from;
    to = doc.lineAt(sel.to).to;
  } else {
    let n = doc.lineAt(sel.head).number;
    while (n > 1 && doc.line(n).text.trim() === "") n--;
    let start = n;
    while (start > 1 && doc.line(start - 1).text.trim() !== "") start--;
    let end = n;
    while (end < doc.lines && doc.line(end + 1).text.trim() !== "") end++;
    from = doc.line(start).from;
    to = doc.line(end).to;
  }

  const lines = doc.sliceString(from, to).split("\n");
  const prompt = lines.map((l) => l.replace(/^\s*--\s?/, "")).join("\n").trim();
  if (!prompt) return;

  const file = doc.toString();
  const commented = lines.map((l) => (/^\s*--/.test(l) || l.trim() === "" ? l : `-- ${l}`)).join("\n");
  view.dispatch({ changes: { from, insert: commented, to } });

  const insertAfterPrompt = (text: string): void => {
    const current = view.state.doc.toString();
    const at = current.indexOf(commented, Math.max(0, from - 1));
    const pos = at < 0 ? current.length : at + commented.length;
    view.dispatch({ changes: { from: pos, insert: `\n${text}` } });
  };

  setPending(1);
  generator(prompt, file)
    .then(insertAfterPrompt, (err: unknown) =>
      insertAfterPrompt(`-- generate failed: ${err instanceof Error ? err.message : String(err)}`),
    )
    .finally(() => setPending(-1));
}
