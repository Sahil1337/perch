// The UI a compiled binary carries inside itself. `bun build --compile` copies every file imported
// with `{ type: "file" }` into the executable and rewrites the import to a path under Bun's virtual
// filesystem, which flattens and hashes the names — so the only way back to "_next/static/x.css"
// is the map the generated compile entry (scripts/gen-ui-entry.mjs) hands to setEmbeddedUi()
// before it starts the CLI. Under Node, or `bun run` from source, nothing ever calls it and the UI
// stays the real directory next to dist/.

/** The one Bun global this file touches; `types: ["node"]` means TypeScript has not heard of it. */
type BunFileOpener = { file(path: string): Blob };

// Read once, through globalThis rather than the bare identifier: under Node there is no `Bun` to
// reference at all, and every path below has to stay a no-op instead of a ReferenceError.
const bun = (globalThis as { Bun?: BunFileOpener }).Bun;

/** UI-relative path ("index.html", "_next/static/x.js") → that file's path inside the binary. */
let embedded: Record<string, string> = {};

export function setEmbeddedUi(files: Record<string, string>): void {
  embedded = files;
}

export function hasEmbeddedUi(): boolean {
  return bun !== undefined && Object.keys(embedded).length > 0;
}

/**
 * The embedded file at a UI-relative path, or undefined when the binary does not carry it. A Blob
 * rather than bytes because it also carries the content type Bun resolved from the extension at
 * compile time — inside the bundle the extensions are gone, so there is nothing to sniff later.
 */
export function embeddedUiFile(uiPath: string): Blob | undefined {
  const bundlePath = embedded[uiPath];
  if (bundlePath === undefined || bun === undefined) return undefined;
  return bun.file(bundlePath);
}
