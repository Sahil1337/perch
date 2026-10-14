// Drives the real CodeMirror view the workspace mounted. Nothing here draws: text goes in as the
// transactions a keystroke makes, keys go through the editor's own keymap, and the completion popup
// is the app's own source answering. The view is found through its DOM, the one handle SqlEditor
// leaves outside itself.

import {
  type Completion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  startCompletion,
} from "@codemirror/autocomplete";
import { Compartment, type SelectionRange, StateEffect } from "@codemirror/state";
import { EditorView, runScopeHandlers, tooltips } from "@codemirror/view";
import type { Clock } from "./autoplay";

const MAC = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? "");

/** The first editor under `root` that is laid out, or the one matching `select`. */
export function findEditor(
  root: ParentNode,
  select: (dom: HTMLElement) => boolean = (dom) => dom.getBoundingClientRect().width > 0,
): EditorView | null {
  for (const dom of root.querySelectorAll<HTMLElement>(".cm-editor")) {
    if (!select(dom)) continue;
    const view = EditorView.findFromDOM(dom);
    if (view) return view;
  }
  return null;
}

/** Waits for an editor to appear under `root`: the workspace mounts it a frame after the buffer. */
export async function waitForEditor(
  root: ParentNode,
  clock: Clock,
  select?: (dom: HTMLElement) => boolean,
): Promise<EditorView> {
  for (;;) {
    const view = findEditor(root, select);
    if (view) return view;
    await clock.sleep(50);
  }
}

const housed = new WeakSet<EditorView>();

/**
 * Mounts an editor's popups inside the scene rather than as fixed boxes over the page. The app's
 * popups are `position: fixed`, which escapes every pane in a full window; inside a scaled frame a
 * fixed box is caught by the transform and clipped by its pane instead. Parented to the stage, they
 * overflow their pane as they do in the app, scale with it, and flip within the window's bounds.
 */
export function houseTooltips(view: EditorView, parent: HTMLElement, space: () => DOMRect): void {
  if (housed.has(view)) return;
  housed.add(view);
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      tooltips({ parent, position: "absolute", tooltipSpace: () => space() }),
    ),
  });
}

const scripted = new WeakMap<EditorView, Compartment>();

/**
 * The editor as a script drives it. Its caret and focused styling are drawn without taking focus —
 * a scene must never pull the page's focus into itself, or a visitor's Space and arrow keys would
 * type into it — and anything that would scroll the caret into view scrolls the editor alone: by
 * default CodeMirror scrolls every ancestor too, the page included, and a scene playing below the
 * fold must not move the page. Off again once a usable scene's visitor first focuses its app.
 */
export function scriptEditor(view: EditorView, on: boolean): void {
  let compartment = scripted.get(view);
  const extensions = on
    ? [EditorView.editorAttributes.of({ class: "cm-focused" }), EditorView.scrollHandler.of(scrollInside)]
    : [];
  if (!compartment) {
    if (!on) return;
    compartment = new Compartment();
    scripted.set(view, compartment);
    view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(extensions)) });
    return;
  }
  view.dispatch({ effects: compartment.reconfigure(extensions) });
}

/** Runs inside CodeMirror's measure phase, where its own layout reads are off limits: DOM only. */
function scrollInside(view: EditorView, range: SelectionRange): boolean {
  const { node } = view.domAtPos(range.head);
  const line = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line");
  if (!line) return true;
  const scroller = view.scrollDOM;
  const box = scroller.getBoundingClientRect();
  const rect = line.getBoundingClientRect();
  const scale = box.height / scroller.clientHeight || 1;
  if (rect.top < box.top) scroller.scrollTop -= (box.top - rect.top) / scale;
  else if (rect.bottom > box.bottom) scroller.scrollTop += (rect.bottom - box.bottom) / scale;
  return true;
}

/**
 * Brings the caret into view inside the editor only. A script's own moves never ask CodeMirror to
 * scroll: they also run where `scriptEditor` is off (a reduced-motion final frame, or after a usable
 * scene's hand-over), and there its default would scroll the page to a window below the fold.
 */
function revealCaret(view: EditorView): void {
  view.requestMeasure({ read: () => undefined, write: (_, v) => scrollInside(v, v.state.selection.main) });
}

/** Puts the caret at a 1-based line and 0-based column. */
export function placeCaret(view: EditorView, line: number, col = 0): void {
  const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
  const anchor = Math.min(target.from + col, target.to);
  view.dispatch({ selection: { anchor }, userEvent: "select" });
  revealCaret(view);
}

/** One character, as typing it would: an input transaction at the caret, which is what wakes completion. */
export function typeChar(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.type" });
  revealCaret(view);
}

/** Human pace: quicker inside a word, a beat longer after a space or punctuation. */
export function keyDelay(ch: string, previous: string | undefined): number {
  const jitter = (ch.charCodeAt(0) * 37 + (previous?.charCodeAt(0) ?? 7) * 11) % 50;
  if (ch === " ") return 140 + jitter;
  if (/[.,()=]/.test(ch)) return 170 + jitter;
  if (previous === " " || previous === undefined) return 150 + jitter;
  return 95 + jitter;
}

export async function typeText(view: EditorView, text: string, clock: Clock): Promise<void> {
  let previous: string | undefined;
  for (const ch of text) {
    typeChar(view, ch);
    await clock.sleep(keyDelay(ch, previous));
    previous = ch;
  }
}

/**
 * A key through the editor's own keymap: `Enter` accepts a completion, `Mod-Enter` runs the
 * statement, `Ctrl-Space` asks for completion — the bindings SqlEditor installed, not a copy.
 */
export function pressKey(view: EditorView, key: "Enter" | "ArrowDown" | "ArrowUp" | "Escape" | "Mod-Enter" | "Ctrl-Space"): boolean {
  const init: KeyboardEventInit = { bubbles: true, cancelable: true };
  if (key === "Mod-Enter") Object.assign(init, { key: "Enter", code: "Enter", keyCode: 13, metaKey: MAC, ctrlKey: !MAC });
  else if (key === "Ctrl-Space") Object.assign(init, { key: " ", code: "Space", keyCode: 32, ctrlKey: true });
  else Object.assign(init, { key, code: key, keyCode: { Enter: 13, ArrowDown: 40, ArrowUp: 38, Escape: 27 }[key] });
  const handled = runScopeHandlers(view, new KeyboardEvent("keydown", init), "editor");
  // Ctrl-Space is bound by the completion keymap on most platforms; ask directly where it is not.
  if (!handled && key === "Ctrl-Space") return startCompletion(view);
  return handled;
}

export function completionOpen(view: EditorView): boolean {
  return completionStatus(view.state) === "active" && currentCompletions(view.state).length > 0;
}

/** Waits for the popup the app's completion source opens, up to `timeout` ms of scene time. */
export async function waitForCompletion(view: EditorView, clock: Clock, timeout = 1500): Promise<boolean> {
  for (let waited = 0; waited < timeout; waited += 40) {
    if (completionOpen(view)) return true;
    await clock.sleep(40);
  }
  return completionOpen(view);
}

export function completionLabels(view: EditorView): string[] {
  return currentCompletions(view.state).map((option) => option.displayLabel ?? option.label);
}

/**
 * Walks the selection down to the option `want` picks, one arrow press at a time like a person
 * reading the list, then accepts it with Enter. Returns the option, or null when the popup did not
 * offer one — the scene then knows the app answered differently and does not pretend otherwise.
 */
export async function pickCompletion(
  view: EditorView,
  clock: Clock,
  want: (option: Completion, index: number) => boolean,
  pace = { read: 650, step: 260 },
): Promise<Completion | null> {
  if (!(await waitForCompletion(view, clock))) return null;
  const options = currentCompletions(view.state);
  const index = options.findIndex(want);
  if (index < 0) return null;
  await clock.sleep(pace.read);
  while ((selectedCompletionIndex(view.state) ?? 0) < index) {
    pressKey(view, "ArrowDown");
    await clock.sleep(pace.step);
  }
  const picked = options[index]!;
  pressKey(view, "Enter");
  return picked;
}
