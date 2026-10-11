/** A key in a shortcut: "mod" and "alt" are named so they can read ⌘ ⌥ on a Mac and Ctrl Alt elsewhere. */
export type ShortcutKey = "mod" | "alt" | (string & {});

export type BoxItem = {
  /** Names the crop, `img/box-<key>.webp`. */
  key: string;
  title: string;
  text: string;
  keys?: readonly ShortcutKey[];
};

export const BOX_ITEMS: readonly BoxItem[] = [
  {
    key: "palette",
    title: "Command palette",
    text: "Actions, open tabs, connections, databases and tables, all from one search box.",
    keys: ["mod", "K"],
  },
  {
    key: "statement",
    title: "Run the statement you’re on",
    text: "Runs the selection, or the statement under the cursor. Each statement gets its own result tab.",
    keys: ["mod", "↵"],
  },
  {
    key: "errors",
    title: "Errors where they happen",
    text: "A failed statement is underlined where the database says it broke, with the message and hint on hover.",
  },
  {
    key: "format",
    title: "Format when you ask",
    text: "Reformats the file from the shortcut, the context menu or the palette. Never on save.",
    keys: ["⇧", "alt", "F"],
  },
  {
    key: "history",
    title: "Run history",
    text: "Every run is kept, by day, across restarts. Record results too, and reopen an old run with its rows.",
  },
  {
    key: "export",
    title: "Export to CSV",
    text: "Download any result as a .csv file, from the results pane or a notebook cell.",
  },
  {
    key: "hosted",
    title: "Hosted databases",
    text: "Paste a postgres:// or mysql:// URL. Remote hosts connect over TLS by default.",
  },
  {
    key: "discover",
    title: "Finds your local servers",
    text: "Postgres and MySQL on their default ports, from Homebrew, system services, or Docker and Podman containers.",
  },
];

export const cropUrl = (key: string) => `${import.meta.env.BASE_URL}img/box-${key}.webp`;
