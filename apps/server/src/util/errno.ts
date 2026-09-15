// The `code` an fs/net error carries ("ENOENT", "EADDRINUSE", ...). Node types it on
// NodeJS.ErrnoException, but every `catch (err)` hands us `unknown`, so the cast is written once
// here instead of at each call site.

export function errnoCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}
