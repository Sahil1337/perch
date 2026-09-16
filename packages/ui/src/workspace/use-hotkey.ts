"use client";

// Global keyboard shortcuts.
//
// These have to be window-level: ⌘↵ must run the query while the caret is in the editor, and ⌘B
// must work wherever focus happens to be. A handler on the component that renders the button would
// only fire when that button already had focus, which is never when you want it.
//
// The one thing a global handler must not do is steal a keystroke from someone typing. Anything
// with a bare printable key is ignored inside an input, a textarea or a contenteditable —
// CodeMirror included, which renders a contenteditable. Modifier combinations are allowed through,
// because ⌘S inside the editor is exactly where you press it.

import * as React from "react";

export type Hotkey = {
  /** `event.key`, compared case-insensitively: "s", "Enter", "k". */
  key: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

function matches(event: KeyboardEvent, hotkey: Hotkey): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return (
    event.key.toLowerCase() === hotkey.key.toLowerCase() &&
    mod === Boolean(hotkey.mod) &&
    event.shiftKey === Boolean(hotkey.shift) &&
    event.altKey === Boolean(hotkey.alt)
  );
}

/**
 * Binds one global shortcut for as long as the component is mounted.
 *
 * `handler` is held in a ref so a caller does not have to memoise it — passing an inline closure is
 * the normal case, and re-binding the listener on every render would be a waste.
 */
export function useHotkey(hotkey: Hotkey, handler: () => void, enabled = true): void {
  const latest = React.useRef(handler);
  latest.current = handler;

  const { key, mod, shift, alt } = hotkey;

  React.useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const binding: Hotkey = { key, mod, shift, alt };
      if (!matches(event, binding)) return;
      // A shortcut with no modifier belongs to whatever the user is typing into.
      if (!binding.mod && !binding.alt && isTypingTarget(event.target)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, mod, shift, alt, enabled]);
}

/** The label for a shortcut, so a Kbd and its handler cannot drift apart. */
export function hotkeyLabel(hotkey: Hotkey, platform = globalThis.navigator?.platform ?? ""): string {
  const mac = /mac|iphone|ipad/i.test(platform);
  const keyLabel =
    hotkey.key === "Enter" ? "↵" : hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return [
    hotkey.mod ? (mac ? "⌘" : "Ctrl") : "",
    hotkey.shift ? "⇧" : "",
    hotkey.alt ? (mac ? "⌥" : "Alt") : "",
    keyLabel,
  ].join("");
}
