// Browsing the machine's folders, so "open a workspace" can be a picker rather than a path you
// have to type from memory. The browser cannot do this itself: `showDirectoryPicker()` hands back
// an opaque handle, not a path, and the file API works in paths because the server is what reads
// the disk.

export type BrowseEntry = {
  name: string;
  /** Absolute, spelled the way this OS spells it. */
  path: string;
};

export type BrowseResult = {
  /** The folder that was listed, resolved and absolute. */
  path: string;
  /** One level up, or null at the top of the filesystem. */
  parent: string | null;
  /** The user's home directory — the sensible place to start. */
  home: string;
  /** Sub-directories only, name-sorted. Files are irrelevant when picking a folder. */
  entries: BrowseEntry[];
};
