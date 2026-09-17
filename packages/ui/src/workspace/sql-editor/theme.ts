// The editor's chrome, in CodeMirror's own styling API. Nothing here hardcodes a colour:
// highlighting maps to theme-token classes and every value reads `var(--color-*)`.

import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** Lezer tags → theme-token classes, so `highlightSql` and the editor cannot drift apart. */
export const sqlHighlighting = HighlightStyle.define([
  { class: "text-info-foreground", tag: tags.keyword },
  { class: "text-success-foreground", tag: [tags.string, tags.special(tags.string)] },
  { class: "text-warning-foreground", tag: [tags.number, tags.bool, tags.null] },
  { class: "text-muted-foreground italic", tag: [tags.lineComment, tags.blockComment] },
  { class: "text-foreground/80", tag: [tags.typeName, tags.standard(tags.name)] },
  { class: "text-muted-foreground", tag: [tags.operator, tags.punctuation] },
]);

/**
 * Height is the one thing a pane editor and a cell editor disagree about: a pane fills its space and
 * scrolls inside it, a cell grows with its content. CodeMirror does the latter by not being told a height.
 */
export const paneHeight = EditorView.theme({ "&": { height: "100%" } });
export const cellHeight = EditorView.theme({
  "&": { height: "auto" },
  ".cm-scroller": { overflow: "visible" },
});

/**
 * CodeMirror's chrome. A style object is legitimate here because the library renders its own DOM and
 * takes one, so every value is still a theme token. The active line must be translucent: CodeMirror
 * paints the selection in a layer behind the content, and an opaque background would hide it.
 */
export const editorThemeBase = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6875", overflow: "auto" },
  ".cm-content": { caretColor: "var(--color-foreground)", padding: "0.5rem 0" },
  ".cm-line": { padding: "0 0.75rem" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-foreground)",
    borderLeftWidth: "2px",
  },
  // The focused selection has to be claimed at the depth CodeMirror claims it — its base theme
  // styles `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`, five
  // classes, and a plainer selector loses to it however late it is declared. What wins there is
  // `#d7d4f0`, because the editor is in CodeMirror's LIGHT scope: its `dark` flag is fixed when a
  // theme is built and the app's mode flips at runtime, so it is never set. In dark mode that is a
  // near-white slab over dark syntax, which is the whole bug. An equal selector settles it: base
  // themes mount first, so this module's rules come later in the sheet — and `.cm-editor`, which is
  // on the same wrapper element as the theme's own class, puts this one class ahead of it outright
  // rather than resting on that order.
  "&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--color-info) 30%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--color-accent) 55%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--color-warning) 22%, transparent)",
  },
  "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
    backgroundColor: "var(--color-muted)",
    outline: "1px solid var(--color-border)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-background)",
    borderRight: "1px solid var(--color-border)",
    color: "var(--color-muted-foreground)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--color-accent) 55%, transparent)",
    color: "var(--color-foreground)",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.5rem", padding: "0 0.5rem 0 0.75rem" },
  // CodeMirror's default squiggle is an inlined SVG in a fixed red; an underline in the
  // destructive token is the same signal and follows the theme.
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--color-destructive)",
    textUnderlineOffset: "0.2rem",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    color: "var(--color-popover-foreground)",
    fontFamily: "var(--font-sans)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "0.125rem 0.5rem" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-foreground)",
  },
  ".cm-completionDetail": {
    color: "var(--color-muted-foreground)",
    fontStyle: "normal",
    marginLeft: "0.5rem",
  },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--color-destructive)" },
  ".cm-panels": {
    backgroundColor: "var(--color-sidebar)",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-sans)",
  },
});
