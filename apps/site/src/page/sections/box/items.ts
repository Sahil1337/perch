/** A key in a shortcut: "mod" and "alt" are named so they can read ⌘ ⌥ on a Mac and Ctrl Alt elsewhere. */
export type ShortcutKey = "mod" | "alt" | (string & {});

export type BoxItem = {
  /** Names the crop, `img/box-<key>.webp`. */
  key: string;
  title: string;
  text: string;
  keys?: readonly ShortcutKey[];
  /** Below lg, where the crop is drawn at a fraction of its size, the part that tells the story:
      its centre as fractions of the crop, and how far to zoom in on it. */
  focus: { x: number; y: number; zoom: number };
};

export const BOX_ITEMS: readonly BoxItem[] = [
  {
    key: "palette",
    title: "Command palette",
    text: "Actions, open tabs, connections, databases and tables, all from one search box.",
    keys: ["mod", "K"],
    focus: { x: 0.35, y: 0.4, zoom: 1.5 },
  },
  {
    key: "statement",
    title: "Run the statement you’re on",
    text: "Runs the selection, or the statement under the cursor. Each statement gets its own result tab.",
    keys: ["mod", "↵"],
    focus: { x: 0.3, y: 0.5, zoom: 1.6 },
  },
  {
    key: "errors",
    title: "Errors where they happen",
    text: "A failed statement is underlined where the database says it broke, with the message and hint on hover.",
    focus: { x: 0.575, y: 0.25, zoom: 1.22 },
  },
  {
    key: "format",
    title: "Format when you ask",
    text: "Reformats the file from the shortcut, the context menu or the palette. Never on save.",
    keys: ["⇧", "alt", "F"],
    focus: { x: 0.75, y: 0.3, zoom: 1.6 },
  },
  {
    key: "history",
    title: "Run history",
    text: "Every run is kept, by day, across restarts. Record results too, and reopen an old run with its rows.",
    focus: { x: 0.25, y: 0.5, zoom: 1.6 },
  },
  {
    key: "export",
    title: "Export to CSV",
    text: "Download any result as a .csv file, from the results pane or a notebook cell.",
    focus: { x: 0.7, y: 0.35, zoom: 1.6 },
  },
  {
    key: "hosted",
    title: "Hosted databases",
    text: "Paste a postgres:// or mysql:// URL. Remote hosts connect over TLS by default.",
    focus: { x: 0.45, y: 0.5, zoom: 1.45 },
  },
  {
    key: "discover",
    title: "Finds your local servers",
    text: "Postgres and MySQL on their default ports, from Homebrew, system services, or Docker and Podman containers.",
    focus: { x: 0.5, y: 0.62, zoom: 1.3 },
  },
];

export const cropUrl = (key: string) => `${import.meta.env.BASE_URL}img/box-${key}.webp`;
