// Which scene the visitor is using. A page can hold several real workspaces, but the app was written
// as the only one in its window: its shortcuts listen on `window`, its dialogs open on `window`
// events, and its popups portal to <body>. So only the usable scene, once it is the visitor's,
// mounts the parts that listen globally, the shortcuts reach it only from inside it, and a popup it
// opens is painted in its dark theme rather than the page's.

let active: HTMLElement | null = null;
let lastInside = 0;

/** Makes `root` (a scene's window element) the one in use. */
export function activateScene(root: HTMLElement): void {
  if (active === root) return;
  active?.removeEventListener("pointerover", touch, true);
  active?.removeEventListener("pointerdown", touch, true);
  active?.removeEventListener("focusin", touch, true);
  active = root;
  root.addEventListener("pointerover", touch, true);
  root.addEventListener("pointerdown", touch, true);
  root.addEventListener("focusin", touch, true);
  lastInside = performance.now();
  install();
}

export function deactivateScene(root: HTMLElement): void {
  if (active !== root) return;
  root.removeEventListener("pointerover", touch, true);
  root.removeEventListener("pointerdown", touch, true);
  root.removeEventListener("focusin", touch, true);
  active = null;
}

function touch(): void {
  lastInside = performance.now();
}

/** The workspace's own bindings (apps/web's shell, the palette, the grid and the settings gear). */
const BOUND = new Set(["k", "b", "j", "s", "\\", ","]);

let installed = false;

/**
 * Registered once, before any workspace mounts, so it runs ahead of every `useHotkey` listener on
 * `window`. It runs last in the event's path, after the page's own handlers, and prevents no
 * default — it only keeps a workspace's shortcut from firing when the visitor is not inside it.
 */
function install(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || !BOUND.has(event.key.toLowerCase())) return;
    const target = event.target instanceof Node ? event.target : null;
    if (active && target && active.contains(target)) return;
    event.stopImmediatePropagation();
  });
  new MutationObserver((records) => {
    if (!active || performance.now() - lastInside > 2000) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.hasAttribute("data-base-ui-portal")) {
          node.classList.add("dark", "text-foreground", "font-sans");
        }
      }
    }
  }).observe(document.body, { childList: true });
}

/** Called at module load by the workspace shell, so the guard is in place before any hotkey is. */
export function installSceneGuard(): void {
  install();
}
